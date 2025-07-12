import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Database configurations
export const databaseConfigs = pgTable("database_configs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'sqlserver', 'postgresql'
  connectionString: text("connection_string").notNull(),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Query history
export const queryHistory = pgTable("query_history", {
  id: serial("id").primaryKey(),
  naturalQuery: text("natural_query").notNull(),
  generatedSql: text("generated_sql").notNull(),
  executionTime: integer("execution_time"), // in milliseconds
  rowCount: integer("row_count"),
  status: text("status").notNull(), // 'success', 'error'
  errorMessage: text("error_message"),
  results: jsonb("results"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertDatabaseConfigSchema = createInsertSchema(databaseConfigs).omit({
  id: true,
  createdAt: true,
});

export const insertQueryHistorySchema = createInsertSchema(queryHistory).omit({
  id: true,
  createdAt: true,
});

// Types
export type DatabaseConfig = typeof databaseConfigs.$inferSelect;
export type InsertDatabaseConfig = z.infer<typeof insertDatabaseConfigSchema>;
export type QueryHistory = typeof queryHistory.$inferSelect;
export type InsertQueryHistory = z.infer<typeof insertQueryHistorySchema>;

// API request/response types
export const naturalLanguageQuerySchema = z.object({
  query: z.string().min(1).max(500),
});

export const queryExecutionResponseSchema = z.object({
  naturalQuery: z.string(),
  generatedSql: z.string(),
  results: z.array(z.record(z.any())),
  executionTime: z.number(),
  rowCount: z.number(),
  status: z.enum(['success', 'error']),
  errorMessage: z.string().optional(),
});

export type NaturalLanguageQuery = z.infer<typeof naturalLanguageQuerySchema>;
export type QueryExecutionResponse = z.infer<typeof queryExecutionResponseSchema>;
