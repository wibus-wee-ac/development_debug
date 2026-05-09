// Input: Drizzle schema modules and path helpers
// Output: Public schema exports and migration path helper
// Position: @cradle/db entrypoint for schema consumers

export * from './schema'
export * as dbSchema from './schema'
export { getMigrationsPath } from './paths'
