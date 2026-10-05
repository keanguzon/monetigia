"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Tags, ArrowDownLeft, ArrowUpRight, Edit2, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Input } from "@/components/ui/input";
import { isValidUuid } from "@/lib/utils";

const AddCategoryModal = dynamic(() => import("@/components/categories/AddCategoryModal"), {
  ssr: false,
});

type Category = {
  id: string;
  name: string;
  type: string;
  color?: string;
  icon?: string;
  is_default?: boolean;
  user_id?: string;
  created_at?: string;
};

export default function CategoriesPage() {
  const supabase = createClient();
  const sb = supabase as any;

  const [categories, setCategories] = useState<Category[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const { toast } = useToast();

  const startEditingCategory = (categoryId: string, currentName: string) => {
    setEditingCategoryId(categoryId);
    setEditingCategoryName(currentName);
  };

  const saveCategoryName = async (categoryId: string) => {
    if (!isValidUuid(categoryId)) {
      toast({ title: "Error", description: "Invalid category id", variant: "destructive" });
      return;
    }

    const newName = editingCategoryName.trim();
    if (!newName) {
      setEditingCategoryId(null);
      return;
    }

    if (newName.length > 50) {
      toast({ title: "Error", description: "Category name must be 50 characters or fewer", variant: "destructive" });
      return;
    }

    const currentCat = categories.find((c) => c.id === categoryId);
    if (!currentCat) {
      toast({ title: "Error", description: "Category not found", variant: "destructive" });
      return;
    }

    if (currentCat && currentCat.name === newName) {
      setEditingCategoryId(null);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) return;

    const { error } = await sb
      .from("categories")
      .update({ name: newName })
      .eq("id", categoryId)
      .eq("user_id", user.id);

    if (error) {
      toast({ title: "Error", description: "Failed to rename category", variant: "destructive" });
      return;
    }

    toast({ title: "Category renamed", description: "The category has been successfully renamed." });
    setEditingCategoryId(null);
    loadCategories();
  };

  const deleteCategory = async (categoryId: string) => {
    if (!isValidUuid(categoryId)) {
      toast({ title: "Error", description: "Invalid category id", variant: "destructive" });
      return;
    }

    if (confirm("Are you sure you want to delete this category? Any transactions using this category will be updated to 'No category', and budgets for this category will be deleted.")) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) return;

      const { error } = await sb
        .from("categories")
        .delete()
        .eq("id", categoryId)
        .eq("user_id", user.id);

      if (error) {
        toast({ title: "Error", description: "Failed to delete category: " + error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Category deleted", description: "The category has been successfully deleted." });
      loadCategories();
    }
  };

  const loadCategories = async () => {
    setIsLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.id) {
      setCategories([]);
      setIsLoading(false);
      return;
    }

    const { data } = await sb
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name");

    setCategories((data ?? []) as Category[]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const incomeCategories = useMemo(
    () => (categories ?? []).filter((c) => c.type === "income"),
    [categories],
  );
  const expenseCategories = useMemo(
    () => (categories ?? []).filter((c) => c.type === "expense"),
    [categories],
  );

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-500">
        {/* Header - Clean Editorial Hierarchy */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Categories</h1>
            <p className="text-sm text-muted-foreground">
              Organize your income and expense streams
            </p>
          </div>
          <Button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto">
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Income Categories Register */}
          <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3 sm:px-5 sm:py-3.5 bg-muted/20">
              <div className="flex items-center gap-2">
                <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Income Categories</h2>
              </div>
              <span className="text-xs font-mono text-muted-foreground/80">
                {incomeCategories.length} {incomeCategories.length === 1 ? "category" : "categories"}
              </span>
            </div>

            <div className="divide-y divide-border/30 flex-1">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-muted/40 rounded animate-pulse w-3/4" />
                  <div className="h-5 bg-muted/40 rounded animate-pulse w-1/2" />
                  <div className="h-5 bg-muted/40 rounded animate-pulse w-2/3" />
                </div>
              ) : incomeCategories.length > 0 ? (
                incomeCategories.map((category) => (
                  <div
                    key={category.id}
                    className="group flex items-center justify-between px-4 py-2.5 sm:py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-background"
                        style={{ backgroundColor: category.color || "#10b981" }}
                      />
                      {editingCategoryId === category.id ? (
                        <div onClick={(e) => e.stopPropagation()} className="w-full">
                          <Input
                            value={editingCategoryName}
                            onChange={(e) => setEditingCategoryName(e.target.value)}
                            className="h-7 text-xs sm:text-sm px-2 w-[160px] font-medium"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCategoryName(category.id);
                              if (e.key === "Escape") setEditingCategoryId(null);
                            }}
                            onBlur={() => saveCategoryName(category.id)}
                          />
                        </div>
                      ) : (
                        <span className="text-xs sm:text-sm font-medium truncate text-foreground">
                          {category.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingCategory(category.id, category.name);
                        }}
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="Rename category"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCategory(category.id);
                        }}
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete category"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No income categories yet
                </div>
              )}
            </div>
          </div>

          {/* Expense Categories Register */}
          <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3 sm:px-5 sm:py-3.5 bg-muted/20">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-rose-500" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Expense Categories</h2>
              </div>
              <span className="text-xs font-mono text-muted-foreground/80">
                {expenseCategories.length} {expenseCategories.length === 1 ? "category" : "categories"}
              </span>
            </div>

            <div className="divide-y divide-border/30 flex-1">
              {isLoading ? (
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-muted/40 rounded animate-pulse w-3/4" />
                  <div className="h-5 bg-muted/40 rounded animate-pulse w-1/2" />
                  <div className="h-5 bg-muted/40 rounded animate-pulse w-2/3" />
                </div>
              ) : expenseCategories.length > 0 ? (
                expenseCategories.map((category) => (
                  <div
                    key={category.id}
                    className="group flex items-center justify-between px-4 py-2.5 sm:py-3 hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0 ring-2 ring-background"
                        style={{ backgroundColor: category.color || "#f43f5e" }}
                      />
                      {editingCategoryId === category.id ? (
                        <div onClick={(e) => e.stopPropagation()} className="w-full">
                          <Input
                            value={editingCategoryName}
                            onChange={(e) => setEditingCategoryName(e.target.value)}
                            className="h-7 text-xs sm:text-sm px-2 w-[160px] font-medium"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveCategoryName(category.id);
                              if (e.key === "Escape") setEditingCategoryId(null);
                            }}
                            onBlur={() => saveCategoryName(category.id)}
                          />
                        </div>
                      ) : (
                        <span className="text-xs sm:text-sm font-medium truncate text-foreground">
                          {category.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingCategory(category.id, category.name);
                        }}
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="Rename category"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCategory(category.id);
                        }}
                        className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete category"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No expense categories yet
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AddCategoryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={loadCategories}
      />
    </>
  );
}
