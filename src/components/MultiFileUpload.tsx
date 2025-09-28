import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Upload, File, X, CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileUploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error' | 'pending';
  errorMessage?: string;
}

interface MultiFileUploadProps {
  onFilesUploaded?: (files: FileUploadItem[]) => void;
  acceptedFileTypes?: Record<string, string[]>;
  maxFileSize?: number;
  maxFiles?: number;
}

const MultiFileUpload: React.FC<MultiFileUploadProps> = ({
  onFilesUploaded,
  acceptedFileTypes = {
    'application/pdf': ['.pdf'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'text/csv': ['.csv']
  },
  maxFileSize = 10 * 1024 * 1024, // 10MB
  maxFiles = 5
}) => {
  const [uploadedFiles, setUploadedFiles] = useState<FileUploadItem[]>([]);

  const simulateUpload = useCallback(async (fileItem: FileUploadItem) => {
    const updateProgress = (progress: number) => {
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { ...f, progress, status: progress === 100 ? 'completed' : 'uploading' } : f
      ));
    };

    // Simulate upload progress
    for (let progress = 0; progress <= 100; progress += 10) {
      await new Promise(resolve => setTimeout(resolve, 100));
      updateProgress(progress);
    }
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles: FileUploadItem[] = acceptedFiles.slice(0, maxFiles - uploadedFiles.length).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      progress: 0,
      status: 'pending' as const
    }));

    setUploadedFiles(prev => [...prev, ...newFiles]);

    // Start uploads
    for (const fileItem of newFiles) {
      setUploadedFiles(prev => prev.map(f => 
        f.id === fileItem.id ? { ...f, status: 'uploading' } : f
      ));
      await simulateUpload(fileItem);
    }

    const completedFiles = uploadedFiles.concat(newFiles.map(f => ({ ...f, status: 'completed' as const, progress: 100 })));
    onFilesUploaded?.(completedFiles);
  }, [uploadedFiles, maxFiles, simulateUpload, onFilesUploaded]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedFileTypes,
    maxSize: maxFileSize,
    disabled: uploadedFiles.length >= maxFiles
  });

  const removeFile = (fileId: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const getStatusIcon = (status: FileUploadItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-error" />;
      case 'uploading':
      case 'pending':
        return <File className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: FileUploadItem['status']) => {
    switch (status) {
      case 'completed':
        return <Badge variant="outline" className="border-success text-success">Completed</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      case 'uploading':
        return <Badge variant="outline" className="border-azure text-azure">Uploading</Badge>;
      case 'pending':
        return <Badge variant="outline">Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            File Upload ({uploadedFiles.length}/{maxFiles})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragActive 
                ? "border-azure bg-azure/5" 
                : "border-muted hover:border-azure hover:bg-azure/5",
              uploadedFiles.length >= maxFiles && "opacity-50 cursor-not-allowed"
            )}
          >
            <input {...getInputProps()} />
            <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            {isDragActive ? (
              <p className="text-foreground">Drop the files here...</p>
            ) : (
              <div>
                <p className="text-foreground mb-2">
                  Drag & drop files here, or click to select
                </p>
                <p className="text-sm text-muted-foreground">
                  Supports PDF, Excel, CSV files up to {Math.round(maxFileSize / 1024 / 1024)}MB
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Uploaded Files</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {uploadedFiles.map((fileItem) => (
                <div key={fileItem.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(fileItem.status)}
                      <div>
                        <p className="font-medium text-foreground">{fileItem.file.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(fileItem.file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusBadge(fileItem.status)}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(fileItem.id)}
                        className="h-8 w-8 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {fileItem.status === 'uploading' && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="text-foreground">{fileItem.progress}%</span>
                      </div>
                      <Progress value={fileItem.progress} className="h-2" />
                    </div>
                  )}
                  
                  {fileItem.status === 'error' && fileItem.errorMessage && (
                    <p className="text-sm text-error mt-2">{fileItem.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default MultiFileUpload;