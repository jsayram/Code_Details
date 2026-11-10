'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { SignInTrigger } from '@/components/auth/SignInButtonComponent';
import { SignedIn, SignedOut, useViewerId } from '@/components/auth/AuthGate';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  FolderGit2,
  FileText,
  Loader2,
  AlertCircle,
  Trash2,
  ExternalLink,
  Download,
  Calendar,
  Folder,
  Link2,
  Unlink,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import '@/styles/foundations.css';
import { AppShell } from '@/components/layout/AppShell';
import { DiscoveryHeader } from '@/components/layout/DiscoveryHeader';
import { ProjectsProvider } from '@/providers/projects-provider';
import { AssignToProjectDialog } from '@/components/docs/AssignToProjectDialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ProjectInfo {
  slug: string;
  projectName: string;
  repoUrl: string;
  createdAt: string;
  chapterCount: number;
  linkedProjectId?: string | null;
  linkedProjectSlug?: string | null;
  linkedProjectTitle?: string | null;
}

function MyDocsContent() {
  // Generator re-key: the active session (Clerk, or Better Auth behind the switch)
  const isSignedIn = !!useViewerId();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [unlinkingSlug, setUnlinkingSlug] = useState<string | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedDocForAssign, setSelectedDocForAssign] = useState<ProjectInfo | null>(null);

  // Load projects
  const loadProjects = useCallback(async () => {
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    
    try {
      const response = await fetch('/api/docs');
      if (!response.ok) {
        throw new Error('Failed to load projects');
      }
      const result = await response.json();
      // API returns { success: true, data: { projects: [...] } }
      setProjects(result.data?.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Delete project
  const handleDelete = async (slug: string) => {
    setDeletingSlug(slug);
    try {
      const response = await fetch(`/api/docs/${slug}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete project');
      }
      
      // Remove from local state
      setProjects((prev) => prev.filter((p) => p.slug !== slug));
    } catch (err) {
      console.error('Delete error:', err);
    } finally {
      setDeletingSlug(null);
    }
  };

  // Unlink doc from project
  const handleUnlink = async (slug: string) => {
    setUnlinkingSlug(slug);
    try {
      const response = await fetch(`/api/docs/${slug}/link-project`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to unlink documentation');
      }
      
      // Update local state to remove linked info
      setProjects((prev) =>
        prev.map((p) =>
          p.slug === slug
            ? { ...p, linkedProjectId: null, linkedProjectSlug: null, linkedProjectTitle: null }
            : p
        )
      );
    } catch (err) {
      console.error('Unlink error:', err);
    } finally {
      setUnlinkingSlug(null);
    }
  };

  // Handle opening assign dialog
  const handleOpenAssignDialog = (doc: ProjectInfo) => {
    setSelectedDocForAssign(doc);
    setAssignDialogOpen(true);
  };

  // Handle assignment completion
  const handleAssigned = (projectSlug: string, projectTitle: string) => {
    // Update local state with the new linked project
    if (selectedDocForAssign) {
      setProjects((prev) =>
        prev.map((p) =>
          p.slug === selectedDocForAssign.slug
            ? { ...p, linkedProjectSlug: projectSlug, linkedProjectTitle: projectTitle }
            : p
        )
      );
    }
    setSelectedDocForAssign(null);
  };

  return (
    <div className="flex justify-center w-full mb-10">
      <div className="w-full max-w-7xl mx-auto px-4 2xl:px-8 3xl:px-12">
        <div className="flex flex-col gap-6 mb-6 py-3">
          {/* UI09.3: the shared header in place of the gradient banner. */}
          <div className="mb-4">
            <DiscoveryHeader
              eyebrow="GitHub Scrapper"
              icon={<Folder className="h-8 w-8" style={{ color: "var(--cd-action)" }} />}
              title="My Generated Docs"
              lead="View and manage your generated architecture documentation"
            />
          </div>

          <div className="relative">
            {/* Auth Check */}
            <SignedOut>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.2 }}
                className="relative z-10"
              >
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Authentication Required</AlertTitle>
                  <AlertDescription>
                    Please sign in to view your generated documentation.
                    <SignInTrigger mode="modal">
                      <Button variant="link" className="px-2 h-auto">
                        Sign In
                      </Button>
                    </SignInTrigger>
                  </AlertDescription>
                </Alert>
              </motion.div>
            </SignedOut>

            <SignedIn>
              {/* Loading State */}
              {loading && (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Error State */}
              {error && (
                <Alert variant="destructive" className="relative z-10">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Empty State */}
              {!loading && !error && projects.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.2 }}
                  className="relative z-10"
                >
                  <Card className="backdrop-blur-sm bg-card/80 text-center py-12">
                    <CardContent>
                      <FolderGit2 className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-xl font-semibold mb-2">No Documentation Yet</h3>
                      <p className="text-muted-foreground mb-6">
                        You haven&apos;t generated any documentation yet. Get started by analyzing a GitHub repository.
                      </p>
                      <Button asChild>
                        <Link href="/github-scrapper">
                          <FolderGit2 className="h-4 w-4 mr-2" />
                          Generate Documentation
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              )}

              {/* Projects List */}
              {!loading && !error && projects.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.2 }}
                  className="space-y-4 relative z-10"
                >
                  {projects.map((project, index) => (
                    <motion.div
                      key={project.slug}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                    >
                      <Card className="backdrop-blur-sm bg-card/80 hover:border-primary/50 transition-colors">
                        <CardHeader className="pb-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-lg truncate">
                                {project.projectName}
                              </CardTitle>
                              <CardDescription className="mt-1">
                                <a
                                  href={project.repoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs hover:text-primary flex items-center gap-1 truncate"
                                >
                                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  {project.repoUrl}
                                </a>
                              </CardDescription>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary">
                                <FileText className="h-3 w-3 mr-1" />
                                {project.chapterCount} chapters
                              </Badge>
                              {project.linkedProjectSlug && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge 
                                        variant="outline" 
                                        className="text-primary"
                                      >
                                        <CheckCircle className="h-3 w-3 mr-1" />
                                        Linked
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p>Linked to: {project.linkedProjectTitle || project.linkedProjectSlug}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-4 w-4" />
                                {new Date(project.createdAt).toLocaleDateString()}
                              </span>
                              {project.linkedProjectSlug && (
                                <Link 
                                  href={`/projects/${project.linkedProjectSlug}`}
                                  className="flex items-center gap-1 text-primary hover:underline"
                                >
                                  <Link2 className="h-4 w-4" />
                                  {project.linkedProjectTitle}
                                </Link>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {/* Assign/Unlink Buttons */}
                              {project.linkedProjectSlug ? (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-orange-500 hover:text-orange-400 cursor-pointer"
                                      disabled={unlinkingSlug === project.slug}
                                    >
                                      {unlinkingSlug === project.slug ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <>
                                          <Unlink className="h-4 w-4 mr-1" />
                                          Unlink
                                        </>
                                      )}
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Unlink Documentation?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will remove the link between this documentation and{' '}
                                        <strong>{project.linkedProjectTitle}</strong>.
                                        The documentation will not be deleted.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-orange-600 text-white hover:bg-orange-500"
                                        onClick={() => handleUnlink(project.slug)}
                                      >
                                        Unlink
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="cursor-pointer"
                                  onClick={() => handleOpenAssignDialog(project)}
                                >
                                  <Link2 className="h-4 w-4 mr-1" />
                                  Assign
                                </Button>
                              )}
                              
                              <Button variant="outline" size="sm" asChild className="cursor-pointer">
                                <Link href={`/github-scrapper/docs/${project.slug}`}>
                                  View Docs
                                </Link>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="cursor-pointer"
                                onClick={() => {
                                  window.open(`/api/docs/${project.slug}/download`, '_blank');
                                }}
                              >
                                <Download className="h-4 w-4" aria-hidden="true" />
                                <span className="sr-only">Download {project.slug}</span>
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-destructive hover:text-destructive cursor-pointer"
                                    disabled={deletingSlug === project.slug}
                                    aria-label={`Delete documentation for ${project.slug}`}
                                  >
                                    {deletingSlug === project.slug ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    )}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Documentation?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete the generated documentation for{' '}
                                      <strong>{project.projectName}</strong>. This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => handleDelete(project.slug)}
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </SignedIn>

            {/* Quick Actions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.4 }}
              className="mt-8 text-center relative z-10"
            >
              <Button asChild size="lg" className="cursor-pointer">
                <Link href="/github-scrapper">
                  <FolderGit2 className="h-5 w-5 mr-2" />
                  Generate New Documentation
                </Link>
              </Button>
            </motion.div>
          </div>
        </div>

        {/* Assign to Project Dialog */}
        {selectedDocForAssign && (
          <AssignToProjectDialog
            open={assignDialogOpen}
            onOpenChange={(open) => {
              setAssignDialogOpen(open);
              if (!open) setSelectedDocForAssign(null);
            }}
            doc={selectedDocForAssign}
            allDocs={projects}
            onAssigned={handleAssigned}
          />
        )}
      </div>
    </div>
  );
}

export default function MyDocsPage() {
  // D08g4e3: the app's login (Clerk or Better Auth).
  const viewerId = useViewerId();

  return (
    <ProjectsProvider userId={viewerId ?? null}>
      <AppShell>
        <div className="cd-foundations cd-canvas">
          <MyDocsContent />
        </div>
      </AppShell>
    </ProjectsProvider>
  );
}
