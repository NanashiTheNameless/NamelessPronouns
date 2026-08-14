export const SUPPORTERS = [
];
export const SUPPORT_LINKS = [
  { name: 'GitHub Sponsors', url: 'https://github.com/sponsors/NanashiTheNameless', note: 'monthly or one-time' },
  { name: 'Ko-fi', url: 'https://ko-fi.com/nanashithenameless', note: 'one-time or monthly' },
  { name: 'Buy Me a Coffee', url: 'https://buymeacoffee.com/namelessnanashi', note: 'one-time or monthly' },
  { name: 'Throne', url: 'https://throne.com/namelessnanashi', note: 'wishlist, gifts instead of money' },
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
