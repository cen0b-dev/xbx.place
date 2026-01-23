const fs = require('fs'); 
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');

// --- CONFIGURATION ---
const TITLES_DIR = './x360db/titles'; 
const OUTPUT_FILE = 'master_index.json';
const GITHUB_BASE = "https://raw.githubusercontent.com/xenia-manager/x360db/refs/heads/main/titles";

const REPOSITORIES = [
    { name: "Redump", url: "https://myrient.erista.me/files/Redump/Microsoft%20-%20Xbox%20360/" },
    { name: "No-Intro", url: "https://myrient.erista.me/files/No-Intro/Microsoft%20-%20Xbox%20360%20(Digital)/" }
];

// --- SEQUEL IDENTIFIERS ---
// If a file matches the game name but is followed immediately by one of these, reject it.
const SEQUEL_IDS = new Set([
    '2', '3', '4', '5', '6', '7', '8', '9',
    'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'
]);

// --- ALIAS DICTIONARY ---
const ALIASES = {
    "nfs": "need for speed",
    "gta": "grand theft auto",
    "cod": "call of duty",
    "gow": "gears of war",
    "mw": "modern warfare",
    "tes": "the elder scrolls",
    "lotr": "lord of the rings",
    "sf": "street fighter",
    "re": "resident evil",
    "dbz": "dragon ball z",
    
    // Noise Removal
    "tom clancys": "", 
    "tom clancy": "", 
    "sid meiers": "",
    "cabelas": "",
    "clive barkers": "",
    "peter jacksons": "",
    "lego": "",
    "warhammer 40000": "warhammer 40k",
    "warhammer 40k": "warhammer 40k"
};

/**
 * Normalizes a string into a hyphenated token string.
 * Ex: "Call of Duty: Black Ops II" -> "call-of-duty-black-ops-ii"
 */
function getCleanKey(str) {
    if (!str) return "";
    let clean = str.toLowerCase();

    // 1. Remove File Extensions (Crucial for the check below)
    clean = clean.replace(/\.zip$|\.iso$/i, '');

    // 2. Remove Tags immediately (Text in () or [])
    // We do this EARLY so "Game, The (USA)" becomes "Game, The"
    clean = clean.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();

    // 3. FIX: Handle ", The", ", A", ", An" suffixes
    // Moves them to the front: "Simpsons, The" -> "The Simpsons"
    if (clean.endsWith(', the')) {
        clean = 'the ' + clean.substring(0, clean.length - 5);
    } else if (clean.endsWith(', a')) {
        clean = 'a ' + clean.substring(0, clean.length - 3);
    } else if (clean.endsWith(', an')) {
        clean = 'an ' + clean.substring(0, clean.length - 4);
    }

    clean = clean.replace(/'/g, ''); // Remove apostrophes

    // 4. Apply Aliases
    for (const [key, replacement] of Object.entries(ALIASES)) {
        const regex = new RegExp(`\\b${key}\\b`, 'g'); 
        clean = clean.replace(regex, replacement);
    }

    // 5. Standardize to tokens
    return clean
        // Replace ANY non-alphanumeric char (space, dot, colon, comma) with a hyphen
        .replace(/[^a-z0-9]+/g, '-')
        // Trim leading/trailing hyphens
        .replace(/^-+|-+$/g, '');
}

function getCleanDisplayName(filename) {
    return filename
        .replace(/\.zip$|\.iso$/i, '')
        .replace(/\(Disc \d+\)/i, '')
        .replace(/\s*\(.*?\)/g, '') 
        .replace(/\s*\[.*?\]/g, '') 
        .trim();
}

function getFileType(filename) {
    const lower = filename.toLowerCase();
    if (lower.includes('(addon)') || lower.includes('(dlc)')) return 'DLC';
    if (lower.includes('(update)')) return 'Update';
    if (lower.includes('demo')) return 'Demo';
    return 'Game';
}

function generateFakeID(str) {
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 8).toUpperCase();
}

async function generateIndex() {
    console.time("Total Time");
    console.log("🚀 Starting Index Generation (With Sequel Guard)...");

    let allMyrientFiles = []; 
    
    // 1. FETCH ALL FILES
    for (const repo of REPOSITORIES) {
        process.stdout.write(`1️⃣  Fetching ${repo.name}... `);
        try {
            const response = await axios.get(repo.url, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } 
            });
            const $ = cheerio.load(response.data);
            let count = 0;

            $('a').each((i, link) => {
                const href = $(link).attr('href');
                if (href && (href.endsWith('.zip') || href.endsWith('.iso'))) {
                    const filename = decodeURIComponent(href);
                    allMyrientFiles.push({
                        filename: filename,
                        url: `${repo.url}${href}`,
                        type: getFileType(filename),
                        cleanKey: getCleanKey(filename),
                        displayName: getCleanDisplayName(filename),
                        isClaimed: false
                    });
                    count++;
                }
            });
            console.log(`✅ Found ${count} files.`);
        } catch (e) { console.log(`❌ Failed: ${e.message}`); }
    }

    const writeStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'w' });
    writeStream.write('[\n'); 
    let isFirstEntry = true;

    const writeEntry = (entry) => {
        if (!isFirstEntry) writeStream.write(',\n');
        writeStream.write(JSON.stringify(entry, null, 2));
        isFirstEntry = false;
    };

    // 2. PROCESS METADATA
    console.log("2️⃣  Processing Local Metadata...");
    if (fs.existsSync(TITLES_DIR)) {
        const titleIds = await fsPromises.readdir(TITLES_DIR);
        const CONCURRENCY = 50; 

        for (let i = 0; i < titleIds.length; i += CONCURRENCY) {
            const chunk = titleIds.slice(i, i + CONCURRENCY);
            
            const chunkResults = await Promise.all(chunk.map(async (titleId) => {
                const infoPath = path.join(TITLES_DIR, titleId, 'info.json');
                if (!fs.existsSync(infoPath)) return null;

                try {
                    const raw = await fsPromises.readFile(infoPath, 'utf8');
                    const data = JSON.parse(raw);
                    const name = data.title?.full || data.title?.reduced || "Unknown";
                    if (name === "Unknown") return null;

                    // Collect valid keys (Main title + Media titles)
                    const validMatchKeys = new Set();
                    validMatchKeys.add(getCleanKey(name));
                    if(data.title.reduced) validMatchKeys.add(getCleanKey(data.title.reduced));
                    if (data.media && Array.isArray(data.media)) {
                        data.media.forEach(m => {
                            if (m.title) validMatchKeys.add(getCleanKey(m.title));
                        });
                    }
                    validMatchKeys.delete("");

                    let validLinks = [];
                    allMyrientFiles.forEach(file => {
                        for (const key of validMatchKeys) {
                            if (file.cleanKey.startsWith(key)) {
                                
                                // --- SEQUEL GUARD ---
                                // Check if the extra characters imply a sequel
                                const remainder = file.cleanKey.slice(key.length);
                                
                                // Remainder must start with a hyphen if strictly tokenized
                                // Ex: "call-of-duty-black-ops-ii" vs "call-of-duty-black-ops" -> remainder "-ii"
                                if (remainder.length > 0 && remainder.startsWith('-')) {
                                    const nextToken = remainder.split('-')[1]; // Get the word after the hyphen
                                    if (SEQUEL_IDS.has(nextToken)) {
                                        // It's a sequel! Skip it.
                                        continue; 
                                    }
                                }
                                
                                validLinks.push({
                                    filename: file.filename,
                                    url: file.url,
                                    type: file.type,
                                    match_score: 100
                                });
                                file.isClaimed = true; 
                                break; 
                            }
                        }
                    });

                    let regions = data.media ? [...new Set(data.media.map(m => m.region))] : [];
                    let rating = (data.user_rating && data.user_rating !== "null") ? parseFloat(data.user_rating) : null;
                    let gallery = (data.artwork && Array.isArray(data.artwork.gallery)) ? data.artwork.gallery : [];

                    return {
                        title_id: titleId,
                        name: name,
                        description: data.description?.full || data.description?.short || "No description.",
                        developer: data.developer || "Unknown",
                        publisher: data.publisher || "Unknown",
                        release_date: data.release_date || null,
                        genre: data.genre || [],
                        rating: rating,
                        regions: regions,
                        icon_url: `${GITHUB_BASE}/${titleId}/artwork/icon.png`,
                        cover_url: `${GITHUB_BASE}/${titleId}/artwork/boxart.jpg`,
                        artwork: { gallery: gallery },
                        downloads: validLinks
                    };

                } catch (err) { return null; }
            }));

            chunkResults.forEach(entry => {
                if (entry) writeEntry(entry);
            });
            
            if (i % 500 === 0) process.stdout.write('.');
        }
    }
    console.log("\n   Metadata processed.");

    // 3. ORPHAN AGGREGATOR
    console.log("3️⃣  Aggregating Orphans...");
    const orphanMap = new Map();

    allMyrientFiles.forEach(file => {
        if (!file.isClaimed) {
            const groupKey = file.displayName;

            if (!orphanMap.has(groupKey)) {
                orphanMap.set(groupKey, {
                    title_id: generateFakeID(groupKey),
                    name: groupKey,
                    description: "This title was found on the file server but has no metadata in the database.",
                    developer: "Unknown",
                    publisher: "Unknown",
                    release_date: null,
                    genre: ["Uncategorized"],
                    rating: null,
                    regions: ["World"],
                    icon_url: "https://via.placeholder.com/64x64.png?text=?", 
                    cover_url: "https://via.placeholder.com/170x235.png?text=No+Data",
                    artwork: { gallery: [] },
                    downloads: []
                });
            }

            orphanMap.get(groupKey).downloads.push({
                filename: file.filename,
                url: file.url,
                type: file.type,
                match_score: 100
            });
        }
    });

    orphanMap.forEach(orphan => {
        writeEntry(orphan);
    });

    writeStream.write('\n]');
    writeStream.end();

    console.log(`\n🎉 Done! Scanned ${allMyrientFiles.length} files.`);
    console.log(`   Consolidated ${orphanMap.size} unique orphan titles.`);
    console.timeEnd("Total Time");
}

generateIndex();