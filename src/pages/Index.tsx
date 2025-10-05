import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, BarChart3, Brain, CheckCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import DocumentUpload from "@/components/DocumentUpload";
import VendorDashboard from "@/components/VendorDashboard";
import AdvancedDocumentDemo from "@/components/AdvancedDocumentDemo";
import { Button } from "@/components/ui/button";
import ChatAssistant from "@/components/ChatAssistant";

const Index = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-foreground">ClarityChain AI</h1>
          <Button variant="outline" onClick={() => navigate("/approval-workflow")}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Approval Workflow
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-8">
            <TabsTrigger value="upload">
              <Upload className="h-4 w-4 mr-2" />
              Upload & Process
            </TabsTrigger>
            <TabsTrigger value="dashboard">
              <BarChart3 className="h-4 w-4 mr-2" />
              Vendor Comparison
            </TabsTrigger>
            <TabsTrigger value="advanced">
              <Brain className="h-4 w-4 mr-2" />
              Advanced Analysis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Upload Documents</h3>
              <p className="text-muted-foreground mb-6">
                Upload vendor documents to extract data, calculate costs, and generate comparison reports.
              </p>
              <DocumentUpload />
            </div>
          </TabsContent>

          <TabsContent value="dashboard" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Vendor Analysis</h3>
              <p className="text-muted-foreground mb-6">
                Compare multiple vendors with TCO calculations, risk scoring, and detailed analysis.
              </p>
              <VendorDashboard />
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Advanced Processing</h3>
              <p className="text-muted-foreground mb-6">
                OCR processing, Bill of Materials extraction, and data normalization.
              </p>
              <AdvancedDocumentDemo />
            </div>
          </TabsContent>
        </Tabs>
      </main>
      
      <ChatAssistant />
    </div>
  );
};

export default Index;
