import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateSQLFromNaturalLanguage, validateSQLQuery } from "./services/openai";
import { databaseManager } from "./services/database";
import { 
  naturalLanguageQuerySchema,
  insertDatabaseConfigSchema,
  type QueryExecutionResponse 
} from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Execute natural language query
  app.post("/api/queries/execute", async (req, res) => {
    try {
      const { query } = naturalLanguageQuerySchema.parse(req.body);
      
      // Get active database configuration
      const dbConfig = await storage.getActiveDatabaseConfig();
      if (!dbConfig) {
        return res.status(400).json({ 
          message: "No active database configuration found. Please configure a database connection first." 
        });
      }

      const startTime = Date.now();
      
      // Get database schema for better context
      let tableSchema = '';
      try {
        const connection = databaseManager.createConnection(dbConfig.type, dbConfig.connectionString);
        const schemaQuery = dbConfig.type === 'postgresql' 
          ? `SELECT table_name, column_name, data_type, is_nullable 
             FROM information_schema.columns 
             WHERE table_schema = 'public' 
             ORDER BY table_name, ordinal_position`
          : `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE 
             FROM INFORMATION_SCHEMA.COLUMNS 
             WHERE TABLE_SCHEMA = 'dbo' 
             ORDER BY TABLE_NAME, ORDINAL_POSITION`;
        
        const schemaResult = await connection.executeQuery(schemaQuery);
        if (schemaResult.recordset.length > 0) {
          const tables = new Map();
          schemaResult.recordset.forEach(row => {
            const tableName = row.table_name || row.TABLE_NAME;
            const columnName = row.column_name || row.COLUMN_NAME;
            const dataType = row.data_type || row.DATA_TYPE;
            const isNullable = row.is_nullable || row.IS_NULLABLE;
            
            if (!tables.has(tableName)) {
              tables.set(tableName, []);
            }
            tables.get(tableName).push(`${columnName} (${dataType}${isNullable === 'YES' ? ', nullable' : ''})`);
          });
          
          tableSchema = Array.from(tables.entries())
            .map(([table, columns]) => `${table}: ${columns.join(', ')}`)
            .join('\n');
        }
        await connection.close();
      } catch (schemaError) {
        // Continue without schema if there's an error
        console.log('Could not fetch schema:', schemaError);
      }

      // Generate SQL from natural language
      const sqlResult = await generateSQLFromNaturalLanguage(query, dbConfig.type, tableSchema);
      
      // Validate the generated SQL
      if (!validateSQLQuery(sqlResult.sql)) {
        await storage.createQueryHistoryEntry({
          naturalQuery: query,
          generatedSql: sqlResult.sql,
          status: 'error',
          errorMessage: 'Generated query failed security validation',
          executionTime: Date.now() - startTime,
          rowCount: 0,
          results: null,
        });
        
        return res.status(400).json({ 
          message: "Generated query failed security validation. Only SELECT statements are allowed." 
        });
      }

      try {
        // Create database connection
        const connection = databaseManager.createConnection(dbConfig.type, dbConfig.connectionString);
        
        // Execute the query
        const queryResult = await connection.executeQuery(sqlResult.sql);
        
        const response: QueryExecutionResponse = {
          naturalQuery: query,
          generatedSql: sqlResult.sql,
          results: queryResult.recordset,
          executionTime: queryResult.executionTime,
          rowCount: queryResult.recordset.length,
          status: 'success'
        };

        // Save to history
        await storage.createQueryHistoryEntry({
          naturalQuery: query,
          generatedSql: sqlResult.sql,
          status: 'success',
          executionTime: queryResult.executionTime,
          rowCount: queryResult.recordset.length,
          results: queryResult.recordset,
        });

        await connection.close();
        res.json(response);
        
      } catch (dbError) {
        const executionTime = Date.now() - startTime;
        const errorMessage = dbError instanceof Error ? dbError.message : 'Database execution failed';
        
        await storage.createQueryHistoryEntry({
          naturalQuery: query,
          generatedSql: sqlResult.sql,
          status: 'error',
          errorMessage,
          executionTime,
          rowCount: 0,
          results: null,
        });

        res.status(500).json({ 
          message: `Database query failed: ${errorMessage}`,
          generatedSql: sqlResult.sql 
        });
      }
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      res.status(500).json({ message: errorMessage });
    }
  });

  // Get query history
  app.get("/api/queries/history", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
      const history = await storage.getQueryHistory(limit);
      res.json(history);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch query history';
      res.status(500).json({ message: errorMessage });
    }
  });

  // Clear query history
  app.delete("/api/queries/history", async (req, res) => {
    try {
      await storage.clearQueryHistory();
      res.json({ message: "Query history cleared successfully" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to clear query history';
      res.status(500).json({ message: errorMessage });
    }
  });

  // Get database configurations
  app.get("/api/database/configs", async (req, res) => {
    try {
      const activeConfig = await storage.getActiveDatabaseConfig();
      res.json({ activeConfig });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch database configuration';
      res.status(500).json({ message: errorMessage });
    }
  });

  // Update database configuration
  app.post("/api/database/configs", async (req, res) => {
    try {
      const configData = insertDatabaseConfigSchema.parse(req.body);
      const config = await storage.createDatabaseConfig(configData);
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration data", errors: error.errors });
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to save database configuration';
      res.status(500).json({ message: errorMessage });
    }
  });

  // Test database connection
  app.post("/api/database/test", async (req, res) => {
    try {
      const { type, connectionString } = req.body;
      
      if (!type || !connectionString) {
        return res.status(400).json({ message: "Database type and connection string are required" });
      }

      const connection = databaseManager.createConnection(type, connectionString);
      const isConnected = await connection.testConnection();
      await connection.close();
      
      if (isConnected) {
        res.json({ success: true, message: "Database connection successful" });
      } else {
        res.status(400).json({ success: false, message: "Database connection failed" });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection test failed';
      res.status(500).json({ success: false, message: errorMessage });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
