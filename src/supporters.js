export const SUPPORTERS = [
  { name: 'RandoTechNerd', url: 'https://randotechnerd.com/', note: 'One-time contribution on August 16, 2026, covering six months of running the server' },
];
export const SUPPORT_LINKS = [
  { name: 'GitHub Sponsors', url: 'https://github.com/sponsors/NanashiTheNameless', note: 'monthly or one-time' },
  { name: 'Buy Me a Coffee', url: 'https://buymeacoffee.com/NamelessNanashi', note: 'one-time or monthly' },
  { name: 'Ko-fi', url: 'https://ko-fi.com/NanashiTheNameless', note: 'one-time or monthly' },
  { name: 'Liberapay', url: 'https://liberapay.com/NamelessNanashi', note: 'recurring' },
  { name: 'Throne', url: 'https://throne.com/NamelessNanashi', note: 'wishlist, gifts instead of money' },
];
export function listSupportLinks() {
  return SUPPORT_LINKS.map((link) => ({
    name: link.name,
    url: link.url,
    note: link.note ?? '',
  }));
}
export function listSupporters() {
  return SUPPORTERS.map((supporter) => ({
    name: supporter.name,
    note: supporter.note ?? '',
    url: supporter.url ?? '',
  }));
}
