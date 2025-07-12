import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { QueryExecutionResponse } from "@shared/schema";

interface QueryResultsProps {
  results: QueryExecutionResponse;
}

export default function QueryResults({ results }: QueryResultsProps) {
  const [viewMode, setViewMode] = useState<'table' | 'json'>('table');
  const { toast } = useToast();

  const handleCopySQL = async () => {
    try {
      await navigator.clipboard.writeText(results.generatedSql);
      toast({
        title: "SQL copied to clipboard",
        description: "The generated SQL query has been copied to your clipboard",
      });
    } catch (error) {
      toast({
        title: "Failed to copy SQL",
        description: "Could not copy SQL to clipboard",
        variant: "destructive",
      });
    }
  };

  const handleExportCSV = () => {
    if (!results.results.length) return;

    const headers = Object.keys(results.results[0]);
    const csvContent = [
      headers.join(','),
      ...results.results.map(row => 
        headers.map(header => {
          const value = row[header];
          return typeof value === 'string' && value.includes(',') 
            ? `"${value}"` 
            : String(value ?? '');
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query-results-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "CSV exported",
      description: "Query results have been exported as CSV",
    });
  };

  return (
    <div className="space-y-6">
      {/* Generated SQL Display */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-slate-900">Generated SQL Query</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopySQL}
              className="flex items-center space-x-1"
            >
              <Copy className="w-4 h-4" />
              <span>Copy</span>
            </Button>
          </div>
          <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
            <code className="text-green-400 whitespace-pre">
              {results.generatedSql}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Results Display */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Query Results</h3>
              <p className="text-sm text-slate-600 mt-1">
                {results.rowCount} row{results.rowCount !== 1 ? 's' : ''} returned in{' '}
                {(results.executionTime / 1000).toFixed(2)} seconds
              </p>
            </div>
            
            <div className="flex items-center space-x-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleExportCSV}
                disabled={!results.results.length}
                className="flex items-center space-x-1"
              >
                <Download className="w-4 h-4" />
                <span>Export CSV</span>
              </Button>
              
              <div className="flex bg-slate-100 rounded-lg p-1">
                <Button
                  size="sm"
                  variant={viewMode === 'table' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('table')}
                  className="px-3 py-1 text-xs h-auto"
                >
                  Table
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === 'json' ? 'default' : 'ghost'}
                  onClick={() => setViewMode('json')}
                  className="px-3 py-1 text-xs h-auto"
                >
                  JSON
                </Button>
              </div>
            </div>
          </div>

          {results.status === 'error' ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center space-x-2 mb-2">
                <Badge variant="destructive">Error</Badge>
                <span className="text-sm font-medium text-red-900">Query execution failed</span>
              </div>
              <p className="text-sm text-red-700">{results.errorMessage}</p>
            </div>
          ) : !results.results.length ? (
            <div className="p-8 text-center text-slate-500">
              <p>No results returned</p>
            </div>
          ) : viewMode === 'table' ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    {Object.keys(results.results[0]).map((column) => (
                      <th
                        key={column}
                        className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider"
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {results.results.map((row, index) => (
                    <tr key={index} className="hover:bg-slate-50">
                      {Object.entries(row).map(([column, value]) => (
                        <td key={column} className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {value === null || value === undefined ? (
                            <span className="text-slate-400 italic">null</span>
                          ) : (
                            String(value)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm overflow-x-auto">
              <pre className="text-green-400">
                {JSON.stringify(results.results, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
