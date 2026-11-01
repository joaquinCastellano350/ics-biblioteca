import { copyFile, mkdir } from 'node:fs/promises';

const source = new URL('../src/notifications/templates/notification.html', import.meta.url);
const directory = new URL('../dist/notifications/templates/', import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(source, new URL('notification.html', directory));
