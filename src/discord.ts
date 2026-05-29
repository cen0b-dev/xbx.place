export const DISCORD_INVITE_URL = "https://discord.gg/PVAxX92T";

export function discordInviteHref(): string {
  return DISCORD_INVITE_URL;
}

export function discordPromoStripMarkup(): string {
  return `
    <div class="discord-promo-strip">
      <div class="discord-promo-copy">
        <i class="fa-brands fa-discord" aria-hidden="true"></i>
        <span>Join the xbx.place community for tips, requests, and updates.</span>
      </div>
      <a class="btn btn-discord btn-discord--compact" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer">
        <i class="fa-brands fa-discord" aria-hidden="true"></i><span>Join Discord</span>
      </a>
    </div>
  `;
}

export function discordCtaButtonMarkup(label = "Join Discord", className = "btn btn-discord"): string {
  return `
    <a class="${className}" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer">
      <i class="fa-brands fa-discord" aria-hidden="true"></i><span>${label}</span>
    </a>
  `;
}

export function discordHeroLinkMarkup(): string {
  return discordCtaButtonMarkup("Join Discord", "btn btn-ghost site-hero-ghost discord-hero-link");
}

export function discordFooterLinkMarkup(): string {
  return `<a href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer">Discord</a>`;
}
