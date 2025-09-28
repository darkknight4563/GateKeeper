import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Cloud, Database, Zap, FileText } from "lucide-react";
import ArchitectureDiagram from "@/components/ArchitectureDiagram";
import DataFlowSteps from "@/components/DataFlowSteps";
import AzureServices from "@/components/AzureServices";
import TechnicalSpecs from "@/components/TechnicalSpecs";

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-azure">
                <Cloud className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Azure Document Intelligence</h1>
                <p className="text-sm text-muted-foreground">Serverless Architecture Design</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-azure text-primary-foreground">Serverless</Badge>
              <Badge variant="outline" className="border-success text-success">Scalable</Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 bg-gradient-to-br from-background to-secondary">
        <div className="container mx-auto px-6">
          <div className="text-center mb-8">
            <h2 className="text-4xl font-bold text-foreground mb-4">
              Serverless Document Processing Architecture
            </h2>
            <p className="text-lg text-muted-foreground max-w-3xl mx-auto">
              A comprehensive Azure-based solution for processing PDF documents, extracting structured data, 
              and generating comparison reports using modern serverless technologies.
            </p>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <Tabs defaultValue="architecture" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-8">
            <TabsTrigger value="architecture">Architecture</TabsTrigger>
            <TabsTrigger value="dataflow">Data Flow</TabsTrigger>
            <TabsTrigger value="services">Azure Services</TabsTrigger>
            <TabsTrigger value="specs">Technical Specs</TabsTrigger>
          </TabsList>

          <TabsContent value="architecture" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">System Architecture Overview</h3>
              <p className="text-muted-foreground mb-6">
                Interactive diagram showing the complete serverless architecture with Azure services integration.
              </p>
              <ArchitectureDiagram />
            </div>
          </TabsContent>

          <TabsContent value="dataflow" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Document Processing Flow</h3>
              <p className="text-muted-foreground mb-6">
                Step-by-step breakdown of how documents flow through the system from upload to final report generation.
              </p>
              <DataFlowSteps />
            </div>
          </TabsContent>

          <TabsContent value="services" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Azure Services Integration</h3>
              <p className="text-muted-foreground mb-6">
                Detailed overview of each Azure service and how they work together to create a robust document processing solution.
              </p>
              <AzureServices />
            </div>
          </TabsContent>

          <TabsContent value="specs" className="space-y-8">
            <div>
              <h3 className="text-2xl font-semibold text-foreground mb-4">Technical Specifications</h3>
              <p className="text-muted-foreground mb-6">
                Comprehensive technical details including security, performance, and operational considerations.
              </p>
              <TechnicalSpecs />
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 bg-card/30">
        <div className="container mx-auto px-6 text-center">
          <p className="text-muted-foreground">
            Built with Azure serverless technologies for scalable document processing
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
