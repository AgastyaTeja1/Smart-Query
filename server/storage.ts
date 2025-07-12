import { 
  databaseConfigs, 
  queryHistory, 
  type DatabaseConfig, 
  type InsertDatabaseConfig,
  type QueryHistory,
  type InsertQueryHistory 
} from "@shared/schema";

export interface IStorage {
  // Database configurations
  getDatabaseConfig(id: number): Promise<DatabaseConfig | undefined>;
  getActiveDatabaseConfig(): Promise<DatabaseConfig | undefined>;
  createDatabaseConfig(config: InsertDatabaseConfig): Promise<DatabaseConfig>;
  updateDatabaseConfig(id: number, config: Partial<InsertDatabaseConfig>): Promise<DatabaseConfig | undefined>;
  
  // Query history
  getQueryHistory(limit?: number): Promise<QueryHistory[]>;
  createQueryHistoryEntry(entry: InsertQueryHistory): Promise<QueryHistory>;
  clearQueryHistory(): Promise<void>;
}

export class MemStorage implements IStorage {
  private databaseConfigs: Map<number, DatabaseConfig> = new Map();
  private queryHistory: Map<number, QueryHistory> = new Map();
  private currentConfigId = 1;
  private currentHistoryId = 1;

  constructor() {
    // Add a default PostgreSQL configuration using the Replit-provided database
    this.databaseConfigs.set(1, {
      id: 1,
      name: "Default PostgreSQL",
      type: "postgresql",
      connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/sample",
      isActive: true,
      createdAt: new Date(),
    });
    this.currentConfigId = 2;
  }

  async getDatabaseConfig(id: number): Promise<DatabaseConfig | undefined> {
    return this.databaseConfigs.get(id);
  }

  async getActiveDatabaseConfig(): Promise<DatabaseConfig | undefined> {
    return Array.from(this.databaseConfigs.values()).find(config => config.isActive);
  }

  async createDatabaseConfig(config: InsertDatabaseConfig): Promise<DatabaseConfig> {
    const id = this.currentConfigId++;
    const newConfig: DatabaseConfig = {
      ...config,
      id,
      isActive: config.isActive ?? false,
      createdAt: new Date(),
    };
    
    // If this is set as active, deactivate others
    if (config.isActive) {
      const existingConfigs = Array.from(this.databaseConfigs.values());
      for (const existingConfig of existingConfigs) {
        existingConfig.isActive = false;
      }
    }
    
    this.databaseConfigs.set(id, newConfig);
    return newConfig;
  }

  async updateDatabaseConfig(id: number, config: Partial<InsertDatabaseConfig>): Promise<DatabaseConfig | undefined> {
    const existing = this.databaseConfigs.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...config };
    
    // If this is set as active, deactivate others
    if (config.isActive) {
      const existingConfigs = Array.from(this.databaseConfigs.values());
      for (const existingConfig of existingConfigs) {
        if (existingConfig.id !== id) {
          existingConfig.isActive = false;
        }
      }
    }
    
    this.databaseConfigs.set(id, updated);
    return updated;
  }

  async getQueryHistory(limit: number = 50): Promise<QueryHistory[]> {
    const history = Array.from(this.queryHistory.values())
      .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
      .slice(0, limit);
    
    return history;
  }

  async createQueryHistoryEntry(entry: InsertQueryHistory): Promise<QueryHistory> {
    const id = this.currentHistoryId++;
    const newEntry: QueryHistory = {
      ...entry,
      id,
      executionTime: entry.executionTime ?? null,
      rowCount: entry.rowCount ?? null,
      errorMessage: entry.errorMessage ?? null,
      results: entry.results ?? null,
      createdAt: new Date(),
    };
    
    this.queryHistory.set(id, newEntry);
    return newEntry;
  }

  async clearQueryHistory(): Promise<void> {
    this.queryHistory.clear();
  }
}

export const storage = new MemStorage();
