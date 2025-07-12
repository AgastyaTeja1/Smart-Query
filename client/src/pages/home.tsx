import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import QueryInterface from "@/components/query-interface";
import QueryResults from "@/components/query-results";
import QueryHistory from "@/components/query-history";
import SettingsModal from "@/components/settings-modal";
import LoadingOverlay from "@/components/loading-overlay";
import { Database, Settings, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const [queryResults, setQueryResults] = useState<any>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  // Get database connection status
  const { data: dbConfig } = useQuery({
    queryKey: ["/api/database/configs"],
  });

  const connectionStatus = dbConfig?.activeConfig ? "connected" : "disconnected";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Database className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">QueryAI</h1>
                <p className="text-xs text-slate-500">Natural Language Database Interface</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-success' : 'bg-danger'}`} />
                <span className="text-sm text-slate-600">
                  {connectionStatus === 'connected' 
                    ? `Connected to ${(dbConfig as any)?.activeConfig?.type === 'postgresql' ? 'PostgreSQL' : 'SQL Server'}` 
                    : 'No Database Connection'
                  }
                </span>
              </div>
              
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSettingsOpen(true)}
                title="Settings"
              >
                <Settings className="w-4 h-4" />
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                title="Help"
              >
                <HelpCircle className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          <QueryInterface
            currentQuery={currentQuery}
            setCurrentQuery={setCurrentQuery}
            setQueryResults={setQueryResults}
            setIsExecuting={setIsExecuting}
          />
          
          {queryResults && (
            <QueryResults results={queryResults} />
          )}
          
          <QueryHistory onQuerySelect={setCurrentQuery} />
        </div>
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <LoadingOverlay isVisible={isExecuting} />
    </div>
  );
}
