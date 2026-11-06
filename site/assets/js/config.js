/*
 * SkyAlps Virtual — site settings.
 * Fill these in once; every empty value hides or falls back gracefully.
 */
window.SKYALPS_CONFIG = {
  // Newsky "join" page of the airline, e.g. "https://newsky.app/airline/<airline id>/join".
  // Empty = the Join button sends pilots to the Newsky sign-up page instead.
  newskyJoinUrl: "https://newsky.app/airline/swu/info",

  // API key created in Newsky > Airline management > General, with ONLY the "map" scope.
  // It is visible in the page source, so never use a key that has the "flights" scope here.
  newskyMapToken: "SWU_TdBryljD20wHuDpNZKBlSuQw6yUQ4j",

  // Discord invite link, e.g. "https://discord.gg/xxxxxxx". Empty = Discord buttons are hidden.
  discordUrl: "",

  // Contact address shown in the footer. Empty = hidden.
  contactEmail: "",
};
