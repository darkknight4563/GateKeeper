import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cloud, Database, Zap, FileText, Shield, Globe } from "lucide-react";

const AzureServices = () => {
  const services = [
    {
      icon: Zap,
      name: "Azure Functions",
      description: "Serverless compute platform for event-driven applications",
      features: [
        "Auto-scaling based on demand",
        "Pay-per-execution pricing",
        "Multiple language support",
        "Event-driven triggers"
      ],
      color: "success"
    },
    {
      icon: Cloud,
      name: "Azure Blob Storage",
      description: "Massively scalable object storage for unstructured data",
      features: [
        "Unlimited storage capacity",
        "Multiple access tiers",
        "Built-in security features",
        "Global replication"
      ],
      color: "azure"
    },
    {
      icon: FileText,
      name: "Azure AI Document Intelligence",
      description: "AI-powered document processing and data extraction",
      features: [
        "Pre-built models for common documents",
        "Custom model training",
        "OCR and text extraction",
        "Form and table recognition"
      ],
      color: "warning"
    },
    {
      icon: Database,
      name: "Azure Cosmos DB",
      description: "Globally distributed, multi-model database service",
      features: [
        "Multi-model database support",
        "Global distribution",
        "Automatic scaling",
        "99.999% availability SLA"
      ],
      color: "error"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {services.map((service, index) => {
        const Icon = service.icon;
        return (
          <Card key={index} className="bg-gradient-card border-border/50 shadow-card hover:shadow-azure transition-all duration-300 group">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className={`p-3 rounded-lg bg-${service.color}/20 group-hover:bg-${service.color}/30 transition-colors`}>
                  <Icon className={`w-6 h-6 text-${service.color}`} />
                </div>
                <div>
                  <CardTitle className="text-lg text-foreground">{service.name}</CardTitle>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {service.description}
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {service.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className={`w-1.5 h-1.5 rounded-full bg-${service.color}`}></div>
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default AzureServices;