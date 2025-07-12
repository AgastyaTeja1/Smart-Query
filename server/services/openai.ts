import OpenAI from "openai";
import dotenv from 'dotenv';

dotenv.config();

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user
const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || process.env.OPENAI_KEY || "default_key"
});

console.log("Using OpenAI key:", process.env.OPENAI_API_KEY);

export interface SQLGenerationResult {
  sql: string;
  explanation: string;
  confidence: number;
  warnings?: string[];
}

export async function generateSQLFromNaturalLanguage(
  naturalQuery: string,
  databaseType: string = 'sqlserver',
  tableSchema?: string
): Promise<SQLGenerationResult> {
  try {
    const systemPrompt = `You are an expert SQL query generator. Convert natural language questions into safe, read-only SQL queries.

Database Type: ${databaseType}
${tableSchema ? `Available Tables and Schema:\n${tableSchema}` : ''}

Rules:
1. Generate ONLY SELECT statements - no INSERT, UPDATE, DELETE, or DDL
2. Use proper ${databaseType} syntax:
   - For SQL Server: Use TOP for limiting results, GETDATE() for current time
   - For PostgreSQL: Use LIMIT for limiting results, NOW() for current time, proper PostgreSQL functions
3. Include appropriate WHERE clauses for filtering
4. Use JOINs when multiple tables are referenced
5. Add LIMIT (PostgreSQL) or TOP (SQL Server) clauses for potentially large result sets
6. Validate that referenced tables/columns likely exist
7. Provide confidence score (0-1) based on query clarity
8. Include warnings for ambiguous requests

Respond with JSON in this exact format:
{
  "sql": "SELECT ...",
  "explanation": "This query...",
  "confidence": 0.95,
  "warnings": ["Optional warning messages"]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: naturalQuery }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const result = JSON.parse(response.choices[0].message.content || '{}');
    
    return {
      sql: result.sql || '',
      explanation: result.explanation || '',
      confidence: Math.max(0, Math.min(1, result.confidence || 0)),
      warnings: result.warnings || []
    };
  } catch (error) {
    throw new Error(`Failed to generate SQL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function validateSQLQuery(sql: string): Promise<boolean> {
  try {
    // Basic validation for read-only queries
    const upperSQL = sql.toUpperCase().trim();
    
    // Check if it's a SELECT query
    if (!upperSQL.startsWith('SELECT')) {
      return false;
    }
    
    // Check for dangerous operations
    const dangerousKeywords = [
      'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 
      'TRUNCATE', 'EXEC', 'EXECUTE', 'SP_', 'XP_'
    ];
    
    for (const keyword of dangerousKeywords) {
      if (upperSQL.includes(keyword)) {
        return false;
      }
    }
    
    return true;
  } catch {
    return false;
  }
}
