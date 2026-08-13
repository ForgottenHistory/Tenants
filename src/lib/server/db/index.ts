import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const sqlite = new Database('local.db');

// SQLite disables foreign key enforcement by default, per connection. Without
// this, every `onDelete: 'cascade'` in the schema is silently ignored and
// deleting a parent row leaves orphans behind.
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Export raw sqlite instance for direct access if needed
export { sqlite };
