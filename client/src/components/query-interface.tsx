import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Play, RotateCcw, Shield, Clock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { QueryExecutionResponse } from "@shared/schema";

interface QueryInterfaceProps {
  currentQuery: string;
  setCurrentQuery: (query: string) => void;
  setQueryResults: (results: any) => void;
  setIsExecuting: (executing: boolean) => void;
}

const exampleQueries = [
  "Show me all users in the Engineering department",
  "What's the average salary by department?",
  "List active projects with budgets over 150000",
  "Find users hired after 2022 with salaries above 80000",
];

export default function QueryInterface({
  currentQuery,
  setCurrentQuery,
  setQueryResults,
  setIsExecuting,
}: QueryInterfaceProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const executeQueryMutation = useMutation({
    mutationFn: async (query: string) => {
      const response = await apiRequest("POST", "/api/queries/execute", { query });
      return response.json() as Promise<QueryExecutionResponse>;
    },
    onMutate: () => {
      setIsExecuting(true);
    },
    onSuccess: (data) => {
      setQueryResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/queries/history"] });
      toast({
        title: "Query executed successfully",
        description: `Returned ${data.rowCount} rows in ${data.executionTime}ms`,
      });
    },
    onError: (error) => {
      toast({
        title: "Query execution failed",
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsExecuting(false);
    },
  });

  const handleExecuteQuery = () => {
    if (!currentQuery.trim()) {
      toast({
        title: "Query required",
        description: "Please enter a query to execute",
        variant: "destructive",
      });
      return;
    }

    if (currentQuery.length > 500) {
      toast({
        title: "Query too long",
        description: "Please limit your query to 500 characters",
        variant: "destructive",
      });
      return;
    }

    executeQueryMutation.mutate(currentQuery);
  };

  const handleClearQuery = () => {
    setCurrentQuery("");
    setQueryResults(null);
  };

  const handleUseExample = (example: string) => {
    setCurrentQuery(example);
  };

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-2">
            Ask your database a question
          </h2>
          <p className="text-slate-600">
            Use natural language to query your database. Try asking about counts, specific records, or data relationships.
          </p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Textarea
              placeholder="e.g., What is the total count of protocols returned? or What is the cell number of the PI?"
              value={currentQuery}
              onChange={(e) => setCurrentQuery(e.target.value)}
              className="min-h-32 resize-none"
              maxLength={500}
            />
            <div className="absolute bottom-4 right-4 text-xs text-slate-400">
              {currentQuery.length}/500
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Button
                onClick={handleExecuteQuery}
                disabled={executeQueryMutation.isPending || !currentQuery.trim()}
                className="flex items-center space-x-2"
              >
                <Play className="w-4 h-4" />
                <span>Execute Query</span>
              </Button>
              
              <Button
                variant="outline"
                onClick={handleClearQuery}
                className="flex items-center space-x-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Clear</span>
              </Button>
            </div>

            <div className="flex items-center space-x-4 text-sm text-slate-500">
              <div className="flex items-center space-x-1">
                <Shield className="w-4 h-4 text-success" />
                <span>READ-ONLY Mode</span>
              </div>
              <div className="flex items-center space-x-1">
                <Clock className="w-4 h-4" />
                <span>~2.3s avg</span>
              </div>
            </div>
          </div>
        </div>

        {/* Example Queries */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <h3 className="text-sm font-medium text-slate-900 mb-3">Example queries</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {exampleQueries.map((example, index) => (
              <button
                key={index}
                onClick={() => handleUseExample(example)}
                className="text-left p-3 border border-slate-200 rounded-lg hover:border-primary hover:bg-blue-50 transition-colors group"
              >
                <div className="text-sm text-slate-700 group-hover:text-primary">
                  {example}
                </div>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
