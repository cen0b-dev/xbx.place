const fs = require('fs'); // Using standard fs for streams
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

function getCleanKey(str) {
    if (!str) return "";
    return str.toLowerCase()
        .replace(/\(.*?\)/g, '') 
        .replace(/\[.*?\]/g, '')
        .replace(/\.zip$|\.iso$|\.7z$/i, '')
        .replace(/[^a-z0-9]/g, ''); 
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
    console.log("🚀 Starting Safe Index Generation...");

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
                        isClaimed: false
                    });
                    count++;
                }
            });
            console.log(`✅ Found ${count} files.`);
        } catch (e) { console.log(`❌ Failed: ${e.message}`); }
    }

    // 2. OPEN WRITE STREAM (Prevents Memory Crash)
    const writeStream = fs.createWriteStream(OUTPUT_FILE, { flags: 'w' });
    writeStream.write('[\n'); // Start JSON array
    let isFirstEntry = true;

    // Helper to write a single entry
    const writeEntry = (entry) => {
        if (!isFirstEntry) writeStream.write(',\n');
        writeStream.write(JSON.stringify(entry, null, 2));
        isFirstEntry = false;
    };

    // 3. PROCESS TITLES
    console.log("2️⃣  Processing Local Metadata...");
    if (fs.existsSync(TITLES_DIR)) {
        const titleIds = await fsPromises.readdir(TITLES_DIR);
        const CONCURRENCY = 50; // Smaller chunks for safety

        for (let i = 0; i < titleIds.length; i += CONCURRENCY) {
            const chunk = titleIds.slice(i, i + CONCURRENCY);
            
            // Process chunk and get results
            const chunkResults = await Promise.all(chunk.map(async (titleId) => {
                const infoPath = path.join(TITLES_DIR, titleId, 'info.json');
                if (!fs.existsSync(infoPath)) return null;

                try {
                    const raw = await fsPromises.readFile(infoPath, 'utf8');
                    const data = JSON.parse(raw);
                    const name = data.title?.full || data.title?.reduced || "Unknown";
                    if (name === "Unknown") return null;

                    const cleanGameName = getCleanKey(name);
                    
                    // --- SAFETY FIX: PREVENT BLACK HOLE ---
                    // If key is too short or empty, DO NOT attempt fuzzy matching
                    if (cleanGameName.length < 3) return null; 

                    let validLinks = [];

                    allMyrientFiles.forEach(file => {
                        // Strict check: File starts with Game Name
                        if (file.cleanKey.startsWith(cleanGameName)) {
                            validLinks.push({
                                filename: file.filename,
                                url: file.url,
                                type: file.type,
                                match_score: 100
                            });
                            file.isClaimed = true; 
                        }
                    });

                    let regions = data.media ? [...new Set(data.media.map(m => m.region))] : [];
                    let rating = (data.user_rating && data.user_rating !== "null") ? parseFloat(data.user_rating) : null;

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
                        downloads: validLinks
                    };

                } catch (err) { return null; }
            }));

            // Write chunk to disk immediately
            chunkResults.forEach(entry => {
                if (entry) writeEntry(entry);
            });
            
            if (i % 500 === 0) process.stdout.write('.');
        }
    }
    console.log("\n   Metadata processed.");

    // 4. ORPHAN SWEEPER
    console.log("3️⃣  Sweeping for Orphans...");
    let orphanCount = 0;

    allMyrientFiles.forEach(file => {
        if (!file.isClaimed) {
            let displayName = file.filename
                .replace(/\.zip$|\.iso$/i, '')
                .replace(/\(World\)|\(USA\)|\(Europe\)|\(Japan\)/g, '')
                .replace(/\(Addon\)|\(DLC\)/g, '')
                .trim();

            const orphanEntry = {
                title_id: generateFakeID(file.filename),
                name: displayName,
                description: "This title was found on the file server but has no metadata in the database.",
                developer: "Unknown",
                publisher: "Unknown",
                release_date: null,
                genre: ["Uncategorized"],
                rating: null,
                regions: ["World"],
                icon_url: "https://via.placeholder.com/64x64.png?text=?", 
                cover_url: "https://via.placeholder.com/170x235.png?text=No+Data",
                downloads: [{
                    filename: file.filename,
                    url: file.url,
                    type: file.type,
                    match_score: 100
                }]
            };
            
            writeEntry(orphanEntry);
            orphanCount++;
        }
    });

    // 5. CLOSE STREAM
    writeStream.write('\n]');
    writeStream.end();

    console.log(`\n🎉 Done! Scanned ${allMyrientFiles.length} files.`);
    console.log(`   Found ${orphanCount} orphans (DLCs/Homebrew).`);
    console.timeEnd("Total Time");
}

generateIndex();