<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">System Prompts</h1>
        <p class="text-sm text-muted-foreground">
          Manage global system prompts injected into LLM requests.
          Set one as the active default. Per-step prompts can be configured in the chain editor.
        </p>
      </div>
      <Dialog v-model:open="showDialog">
        <DialogTrigger as-child>
          <Button @click="resetForm">
            <Plus />
            New Prompt
          </Button>
        </DialogTrigger>
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {{ editingPrompt ? "Edit System Prompt" : "Create System Prompt" }}
            </DialogTitle>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label>Name</Label>
              <Input v-model="formName" placeholder="e.g., Helpful Assistant" />
            </div>
            <div class="space-y-2">
              <Label>Content</Label>
              <Textarea
                v-model="formContent"
                placeholder="You are a helpful assistant..."
                rows="6"
              />
            </div>
            <div class="flex items-center gap-2">
              <Checkbox id="promptDefault" v-model:checked="formIsDefault" />
              <Label for="promptDefault" class="text-sm">
                Set as active default prompt
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="closeDialog">Cancel</Button>
            <Button :disabled="!formName || !formContent" @click="handleSave">
              {{ editingPrompt ? "Update" : "Create" }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="space-y-4">
      <div v-for="i in 2" :key="i" class="rounded-xl border border-border p-6">
        <div class="flex items-center gap-3">
          <div class="h-5 w-32 animate-pulse rounded bg-muted" />
          <div class="h-5 w-16 animate-pulse rounded-full bg-muted" />
        </div>
        <div class="mt-3 h-16 animate-pulse rounded-md bg-muted" />
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="prompts.length === 0"
      class="rounded-xl border-2 border-dashed border-border p-12 text-center"
    >
      <MessageSquare class="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
      <h3 class="text-lg font-medium">No system prompts yet</h3>
      <p class="mt-1 text-sm text-muted-foreground">
        Create a global default prompt to customize LLM behavior across all chains.
      </p>
      <Button class="mt-4" @click="showDialog = true; resetForm()">
        <Plus />
        Create Your First Prompt
      </Button>
    </div>

    <!-- Prompts list -->
    <div v-else class="grid gap-4">
      <Card v-for="prompt in prompts" :key="String(prompt._id)">
        <CardHeader>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <CardTitle class="text-base">{{ prompt.name }}</CardTitle>
              <Badge v-if="prompt.isDefault" variant="default" class="text-xs">
                Active Default
              </Badge>
            </div>
            <div class="flex gap-1">
              <Button variant="ghost" size="icon-sm" @click="startEdit(prompt)">
                <Pencil class="h-3.5 w-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger as-child>
                  <Button variant="ghost" size="icon-sm">
                    <Trash2 class="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete prompt?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete "{{ prompt.name }}".
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      @click="handleRemove(prompt)"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <pre class="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{{ prompt.content }}</pre>
          <p class="mt-2 text-xs text-muted-foreground">
            Updated {{ formatDate(prompt.updatedAt as number) }}
          </p>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, Pencil, Trash2, MessageSquare } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { useSystemPrompts } from "~/composables/useSystemPrompts";

definePageMeta({ layout: "dashboard" });

const { prompts, loading, fetchPrompts, createPrompt, updatePrompt, removePrompt } =
  useSystemPrompts();

const showDialog = ref(false);
const editingPrompt = ref<Record<string, unknown> | null>(null);
const formName = ref("");
const formContent = ref("");
const formIsDefault = ref(false);

const formatDate = (timestamp: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(timestamp));
  } catch {
    return "\u2014";
  }
};

function resetForm() {
  editingPrompt.value = null;
  formName.value = "";
  formContent.value = "";
  formIsDefault.value = false;
}

const startEdit = (prompt: Record<string, unknown>) => {
  editingPrompt.value = prompt;
  formName.value = String(prompt.name);
  formContent.value = String(prompt.content);
  formIsDefault.value = Boolean(prompt.isDefault);
  showDialog.value = true;
};

const closeDialog = () => {
  showDialog.value = false;
  resetForm();
};

const handleSave = async () => {
  if (!formName.value || !formContent.value) return;

  try {
    if (editingPrompt.value) {
      await updatePrompt(String(editingPrompt.value._id), {
        name: formName.value,
        content: formContent.value,
        isDefault: formIsDefault.value,
      });
      toast.success("Prompt updated");
    } else {
      await createPrompt(
        formName.value,
        formContent.value,
        formIsDefault.value,
      );
      toast.success("Prompt created");
    }
  } catch {
    toast.error("Failed to save prompt");
  }

  closeDialog();
};

async function handleRemove(prompt: Record<string, unknown>) {
  try {
    await removePrompt(String(prompt._id));
    toast.success("Prompt deleted");
  } catch {
    toast.error("Failed to delete prompt");
  }
}

onMounted(() => {
  fetchPrompts();
});
</script>
