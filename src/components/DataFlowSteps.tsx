import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Zap, BarChart3, ArrowDown } from "lucide-react";

const DataFlowSteps = () => {
  const steps = [
    {
      icon: Upload,
      title: "Document Upload",
      description: "User uploads PDF documents through the web interface",
      details: [
        "Multi-file upload support",
        "Automatic virus scanning",
        "Secure blob storage in Azure"
      ],
      service: "Azure Blob Storage",
      status: "active"
    },
    {
      icon: FileText,
      title: "Document Parsing",
      description: "Azure AI Document Intelligence extracts structured data",
      details: [
        "OCR text extraction",
        "Table and form recognition",
        "Metadata extraction"
      ],
      service: "Azure AI Services",
      status: "processing"
    },
    {
      icon: Zap,
      title: "Comparison Logic",
      description: "Azure Functions process and compare document data",
      details: [
        "Serverless compute scaling",
        "Custom comparison algorithms",
        "Real-time processing"
      ],
      service: "Azure Functions",
      status: "pending"
    },
    {
      icon: BarChart3,
      title: "Results Display",
      description: "Frontend displays comprehensive comparison reports",
      details: [
        "Interactive dashboards",
        "PDF report generation",
        "Real-time updates"
      ],
      service: "Web Interface",
      status: "completed"
    }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "azure";
      case "processing": return "warning";
      case "pending": return "muted";
      case "completed": return "success";
      default: return "muted";
    }
  };

  return (
    <div className="space-y-6">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={index} className="relative">
            <Card className="bg-gradient-card border-border/50 shadow-card hover:shadow-azure transition-all duration-300">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg bg-${getStatusColor(step.status)}/20`}>
                      <Icon className={`w-6 h-6 text-${getStatusColor(step.status)}`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg text-foreground">{step.title}</CardTitle>
                      <p className="text-sm text-muted-foreground mt-1">
                        {step.description}
                      </p>
                    </div>
                  </div>
                  <Badge 
                    variant="outline" 
                    className={`border-${getStatusColor(step.status)} text-${getStatusColor(step.status)}`}
                  >
                    {step.service}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {step.details.map((detail, detailIndex) => (
                    <li key={detailIndex} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-azure"></div>
                      {detail}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            
            {index < steps.length - 1 && (
              <div className="flex justify-center my-4">
                <ArrowDown className="w-5 h-5 text-azure animate-bounce" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DataFlowSteps;