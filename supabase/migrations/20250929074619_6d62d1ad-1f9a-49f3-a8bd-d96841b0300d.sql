-- Create documents table for storing uploaded files and metadata
CREATE TABLE public.documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'processing', 'completed', 'error')),
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create processing_jobs table for tracking document analysis
CREATE TABLE public.processing_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  job_status TEXT NOT NULL DEFAULT 'queued' CHECK (job_status IN ('queued', 'processing', 'completed', 'failed')),
  job_type TEXT NOT NULL DEFAULT 'document_analysis',
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error_message TEXT,
  result_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create vendor_offers table for storing extracted vendor data
CREATE TABLE public.vendor_offers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  vendor_name TEXT NOT NULL,
  quoted_price DECIMAL(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  items_count INTEGER DEFAULT 0,
  extracted_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create tco_calculations table for TCO analysis results
CREATE TABLE public.tco_calculations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_offer_id UUID NOT NULL REFERENCES public.vendor_offers(id) ON DELETE CASCADE,
  calculated_tco DECIMAL(12,2) NOT NULL,
  breakdown JSONB NOT NULL, -- shipping, handling, risk premium, etc.
  calculation_method TEXT DEFAULT 'standard',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create risk_assessments table for risk scoring
CREATE TABLE public.risk_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_offer_id UUID NOT NULL REFERENCES public.vendor_offers(id) ON DELETE CASCADE,
  risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_factors JSONB NOT NULL, -- array of risk factors
  assessment_data JSONB, -- detailed scoring breakdown
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create lead_time_analysis table
CREATE TABLE public.lead_time_analysis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_offer_id UUID NOT NULL REFERENCES public.vendor_offers(id) ON DELETE CASCADE,
  estimated_lead_time INTEGER NOT NULL, -- in days
  confidence_level DECIMAL(3,2) DEFAULT 0.80, -- 0.00 to 1.00
  factors JSONB, -- factors affecting lead time
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tco_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_time_analysis ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for documents
CREATE POLICY "Users can view their own documents" 
ON public.documents FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" 
ON public.documents FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own documents" 
ON public.documents FOR UPDATE 
USING (auth.uid() = user_id);

-- Create RLS policies for processing_jobs
CREATE POLICY "Users can view processing jobs for their documents" 
ON public.processing_jobs FOR SELECT 
USING (document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert processing jobs for their documents" 
ON public.processing_jobs FOR INSERT 
WITH CHECK (document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid()));

CREATE POLICY "Users can update processing jobs for their documents" 
ON public.processing_jobs FOR UPDATE 
USING (document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid()));

-- Create RLS policies for vendor_offers
CREATE POLICY "Users can view vendor offers for their documents" 
ON public.vendor_offers FOR SELECT 
USING (document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert vendor offers for their documents" 
ON public.vendor_offers FOR INSERT 
WITH CHECK (document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid()));

-- Create RLS policies for tco_calculations
CREATE POLICY "Users can view TCO calculations for their vendor offers" 
ON public.tco_calculations FOR SELECT 
USING (vendor_offer_id IN (
  SELECT vo.id FROM public.vendor_offers vo 
  JOIN public.documents d ON vo.document_id = d.id 
  WHERE d.user_id = auth.uid()
));

CREATE POLICY "Users can insert TCO calculations for their vendor offers" 
ON public.tco_calculations FOR INSERT 
WITH CHECK (vendor_offer_id IN (
  SELECT vo.id FROM public.vendor_offers vo 
  JOIN public.documents d ON vo.document_id = d.id 
  WHERE d.user_id = auth.uid()
));

-- Create RLS policies for risk_assessments
CREATE POLICY "Users can view risk assessments for their vendor offers" 
ON public.risk_assessments FOR SELECT 
USING (vendor_offer_id IN (
  SELECT vo.id FROM public.vendor_offers vo 
  JOIN public.documents d ON vo.document_id = d.id 
  WHERE d.user_id = auth.uid()
));

CREATE POLICY "Users can insert risk assessments for their vendor offers" 
ON public.risk_assessments FOR INSERT 
WITH CHECK (vendor_offer_id IN (
  SELECT vo.id FROM public.vendor_offers vo 
  JOIN public.documents d ON vo.document_id = d.id 
  WHERE d.user_id = auth.uid()
));

-- Create RLS policies for lead_time_analysis
CREATE POLICY "Users can view lead time analysis for their vendor offers" 
ON public.lead_time_analysis FOR SELECT 
USING (vendor_offer_id IN (
  SELECT vo.id FROM public.vendor_offers vo 
  JOIN public.documents d ON vo.document_id = d.id 
  WHERE d.user_id = auth.uid()
));

CREATE POLICY "Users can insert lead time analysis for their vendor offers" 
ON public.lead_time_analysis FOR INSERT 
WITH CHECK (vendor_offer_id IN (
  SELECT vo.id FROM public.vendor_offers vo 
  JOIN public.documents d ON vo.document_id = d.id 
  WHERE d.user_id = auth.uid()
));

-- Create indexes for performance
CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_processing_jobs_document_id ON public.processing_jobs(document_id);
CREATE INDEX idx_processing_jobs_status ON public.processing_jobs(job_status);
CREATE INDEX idx_vendor_offers_document_id ON public.vendor_offers(document_id);
CREATE INDEX idx_tco_calculations_vendor_offer_id ON public.tco_calculations(vendor_offer_id);
CREATE INDEX idx_risk_assessments_vendor_offer_id ON public.risk_assessments(vendor_offer_id);
CREATE INDEX idx_lead_time_analysis_vendor_offer_id ON public.lead_time_analysis(vendor_offer_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vendor_offers_updated_at
  BEFORE UPDATE ON public.vendor_offers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();