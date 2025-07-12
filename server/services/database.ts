import sql from 'mssql';
import { Pool } from 'pg';

export interface DatabaseConnection {
  executeQuery(query: string): Promise<{
    recordset: any[];
    rowsAffected: number[];
    executionTime: number;
  }>;
  testConnection(): Promise<boolean>;
  close(): Promise<void>;
}

export class SQLServerConnection implements DatabaseConnection {
  private pool: sql.ConnectionPool | null = null;
  private config: sql.config;

  constructor(connectionString: string) {
    // Parse connection string
    const serverMatch = connectionString.match(/Server=([^;]+)/);
    const databaseMatch = connectionString.match(/Database=([^;]+)/);
    const userMatch = connectionString.match(/User Id=([^;]+)/);
    const passwordMatch = connectionString.match(/Password=([^;]+)/);
    
    this.config = {
      server: serverMatch ? serverMatch[1] : 'localhost',
      database: databaseMatch ? databaseMatch[1] : '',
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
      requestTimeout: 30000,
      connectionTimeout: 30000,
    };
    
    // Add user credentials if provided
    if (userMatch) this.config.user = userMatch[1];
    if (passwordMatch) this.config.password = passwordMatch[1];
    
    // Handle Integrated Security
    if (connectionString.includes('Integrated Security=true')) {
      delete this.config.user;
      delete this.config.password;
    }
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      this.pool = new sql.ConnectionPool(this.config);
      await this.pool.connect();
    }
    return this.pool;
  }

  async executeQuery(query: string): Promise<{
    recordset: any[];
    rowsAffected: number[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      const pool = await this.getPool();
      const request = pool.request();
      const result = await request.query(query);
      
      const executionTime = Date.now() - startTime;
      
      return {
        recordset: result.recordset || [],
        rowsAffected: result.rowsAffected || [0],
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      throw new Error(`Query execution failed (${executionTime}ms): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const pool = await this.getPool();
      await pool.request().query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }
}

export class PostgreSQLConnection implements DatabaseConnection {
  private pool: Pool | null = null;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  private async getPool(): Promise<Pool> {
    if (!this.pool) {
      this.pool = new Pool({
        connectionString: this.connectionString,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 30000,
        query_timeout: 30000,
      });
    }
    return this.pool;
  }

  async executeQuery(query: string): Promise<{
    recordset: any[];
    rowsAffected: number[];
    executionTime: number;
  }> {
    const startTime = Date.now();
    
    try {
      const pool = await this.getPool();
      const result = await pool.query(query);
      
      const executionTime = Date.now() - startTime;
      
      return {
        recordset: result.rows || [],
        rowsAffected: [result.rowCount || 0],
        executionTime
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      throw new Error(`Query execution failed (${executionTime}ms): ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const pool = await this.getPool();
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export class DatabaseManager {
  private connections: Map<string, DatabaseConnection> = new Map();

  createConnection(type: string, connectionString: string): DatabaseConnection {
    switch (type.toLowerCase()) {
      case 'sqlserver':
        return new SQLServerConnection(connectionString);
      case 'postgresql':
        return new PostgreSQLConnection(connectionString);
      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  }

  async getConnection(connectionId: string): Promise<DatabaseConnection | null> {
    return this.connections.get(connectionId) || null;
  }

  setConnection(connectionId: string, connection: DatabaseConnection): void {
    this.connections.set(connectionId, connection);
  }

  async closeAllConnections(): Promise<void> {
    const connections = Array.from(this.connections.values());
    for (const connection of connections) {
      await connection.close();
    }
    this.connections.clear();
  }
}

export const databaseManager = new DatabaseManager();
