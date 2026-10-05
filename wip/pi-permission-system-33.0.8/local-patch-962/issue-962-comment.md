Confirming this on pi 0.87.0 with `@gotgenes/pi-permission-system` 32.1.0 (33.0.6 has the same `tool-surface-prompt.ts`), plus a local patch that fixes it, in case it helps.

**What I saw on the wire.** I logged `payload.system` in `before_provider_request`.
- Parent session: pi's `<tools>` and `<rules>` sections, then this package's `Available tools:` / `Guidelines:` block appended below them. That is 4,274 extra characters, and pi's unfiltered list includes tools the policy denies.
- A `pi-subagents` child (`builder`, 9 allowed tools): the parent's 14-tool `<tools>` list, with rules telling it to use `advisor`, `subagent`, `todo` and so on, then its own correct 11-tool block at the end. The stale, wider list comes first, as the issue describes.

**Patch.** It only adds to the relocation logic. It changes nothing when pi did not write the preamble (`piAuthoredPreamble: false`), and nothing in the extension tail. In the head region it also removes pi's own `<tools>…</tools>` and `<rules>…</rules>`, but only when both tags sit on their own lines *before* the first `<addendum>`, `<project_context>`, `<skills>` or `<cwd>`. That is where pi writes them, so the same tags quoted in an APPEND_SYSTEM or context file are left alone. This is still text surgery, not the section-replacement seam you mention, so treat it as a stopgap.

<details><summary>diff against 32.1.0 src/exposure/tool-surface-prompt.ts</summary>

```diff
--- a/src/exposure/tool-surface-prompt.ts
+++ b/src/exposure/tool-surface-prompt.ts
@@ -52,6 +52,27 @@
   end: number;
 };
 
+/**
+ * LOCAL PATCH (upstream gotgenes/pi-packages#962, see ~/pi-lab/REPORT.md).
+ *
+ * From pi 0.86 on, Pi writes its tool surface as tagged sections: the tool
+ * list in `<tools>` and the guideline bullets in `<rules>`, each tag on its
+ * own line. The plain headers below never match there, so without this the
+ * narrowed block was appended under Pi's unfiltered one.
+ */
+const PI_TAGGED_TOOL_SURFACE_SECTIONS = ["tools", "rules"] as const;
+
+/**
+ * Opening tags of the sections Pi writes after its tool surface. A `<tools>`
+ * or `<rules>` section that starts past the first of these is not Pi's.
+ */
+const PI_LATER_SECTION_OPENS: ReadonlySet<string> = new Set([
+  "<addendum>",
+  "<project_context>",
+  "<skills>",
+  "<cwd>",
+]);
+
 const AVAILABLE_TOOLS_SECTION_HEADER = "Available tools:";
 const GUIDELINES_SECTION_HEADER = "Guidelines:";
 
@@ -95,8 +116,8 @@
   const lines = normalizePrompt(systemPrompt).split("\n");
   const tailStart = extensionTailStart(lines);
   const body = [
-    settleRegion(lines.slice(0, tailStart), inputs.piAuthoredPreamble),
-    settleRegion(lines.slice(tailStart), true),
+    settleRegion(lines.slice(0, tailStart), inputs.piAuthoredPreamble, true),
+    settleRegion(lines.slice(tailStart), true, false),
   ]
     .filter((region) => region.length > 0)
     .join("\n")
@@ -138,11 +159,15 @@
 function settleRegion(
   lines: readonly string[],
   removalAllowed: boolean,
+  piTaggedSections: boolean,
 ): string {
   if (!removalAllowed) {
     return lines.join("\n");
   }
-  const kept = removeToolSurfaceSections(lines);
+  const untagged = removeToolSurfaceSections(lines);
+  const kept = piTaggedSections
+    ? removePiTaggedToolSurface(untagged)
+    : untagged;
   const text = kept.join("\n");
   return kept.length === lines.length ? text : collapseExtraBlankLines(text);
 }
@@ -176,6 +201,33 @@
   );
 }
 
+/**
+ * Remove Pi's own `<tools>` and `<rules>` sections (pi >= 0.86), tags included.
+ *
+ * Only a section whose opening tag comes before the first of Pi's later
+ * sections, and whose closing tag follows it before that point, is removed:
+ * that is where Pi writes them, right under its preamble. The same tags
+ * quoted further down, in the addendum or a context file, are left alone.
+ */
+function removePiTaggedToolSurface(lines: readonly string[]): string[] {
+  let remaining = [...lines];
+  for (const name of PI_TAGGED_TOOL_SURFACE_SECTIONS) {
+    const laterAt = remaining.findIndex((line) =>
+      PI_LATER_SECTION_OPENS.has(line),
+    );
+    const limit = laterAt === -1 ? remaining.length : laterAt;
+    const openAt = remaining.indexOf(`<${name}>`);
+    if (openAt === -1 || openAt >= limit) continue;
+    const closeAt = remaining.indexOf(`</${name}>`, openAt + 1);
+    if (closeAt === -1 || closeAt >= limit) continue;
+    remaining = [
+      ...remaining.slice(0, openAt),
+      ...remaining.slice(closeAt + 1),
+    ];
+  }
+  return remaining;
+}
+
 /** This session's tool surface, as Pi would have rendered it. */
 function renderToolSurfaceBlock(inputs: ToolSurfaceInputs): string {
   const sections: string[] = [];
```
</details>

**Checked:**
- A script run on the real 0.87 prompt: pi's sections are gone, one narrowed block remains, and the other sections (`<docs>`, `<addendum>`, `<skills>`, `<cwd>`) are intact.
- It is idempotent: a second pass leaves the prompt unchanged.
- A custom prompt is untouched.
- `<tools>` quoted inside `<addendum>` is kept.
- The old 0.85 format (`Available tools:` … `Current working directory:`) still relocates as before.
- Wire after the patch: the parent prompt went from 31,019 to 25,400 characters, with one tool list, and it is byte-identical across requests, so the prompt cache holds. The child went from 29,520 to 23,891 characters, with exactly its 11 tools, and when asked it listed those 11.
- Bash policy enforcement is unaffected.

Together with `pi-subagents` 21.7.6 (the #958 fix), the child prompt is clean.
