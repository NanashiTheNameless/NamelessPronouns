import { writeFileSync } from 'node:fs';
import { createCrawlerBanlist, crawlerFeeds } from '../src/crawler-banlist.js';

const list = createCrawlerBanlist();
const result = await list.refresh();
const snapshot = list.snapshot();
if (!result?.refreshed) throw new Error('No crawler feeds refreshed; bundled snapshot unchanged.');
writeFileSync(new URL('../config/crawler-ip-ranges.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Refreshed ${result.refreshed}/${crawlerFeeds.length} feeds; snapshot contains ${snapshot.feeds.length} sources (${snapshot.feeds.reduce((sum, entry) => sum + entry.cidrs.length, 0)} ranges). Failed sources retain unexpired cached data.`);
