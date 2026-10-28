// apps/api/migrations/*.sql を番号順に読む(wrangler のマイグレーションと同じ順)。
const files = import.meta.glob('../../../api/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const MIGRATIONS: { name: string; sql: string }[] = Object.entries(files)
  .map(([path, sql]) => ({ name: path.split('/').pop()!, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));
