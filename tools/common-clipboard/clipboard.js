(function () {
  // ---- state ----
  const STORAGE_KEY = "nielsTools:commonClipboard";
  // entries:
  //   {type:"snippet", text, categoryId}  — categoryId is a category's id, or null (uncategorized)
  //   {type:"category", id, text, color, ink}
  // categoryId references a category's stable id (not its array position),
  // so deleting/reordering other entries never desyncs an assignment.
  let entries = [];
  let editingIndex = -1; // index into entries being edited, or -1 while adding a new square
  let draggedIndex = -1; // index into entries currently being dragged, or -1 when nothing's dragging
  let didDrag = false; // set on dragstart, checked by click — a drag ending on the source shouldn't also copy it

  // A fixed palette rather than a computed one — guarantees every color is
  // both "nice and bright" and has a readable, pre-picked ink color (amber
  // is the one light color that needs dark text; the rest read fine white).
  const CATEGORY_COLORS = [
    { color: "#ef4444", ink: "#ffffff" }, // red
    { color: "#f97316", ink: "#ffffff" }, // orange
    { color: "#f59e0b", ink: "#1a1a1a" }, // amber
    { color: "#22c55e", ink: "#ffffff" }, // green
    { color: "#14b8a6", ink: "#ffffff" }, // teal
    { color: "#3b82f6", ink: "#ffffff" }, // blue
    { color: "#8b5cf6", ink: "#ffffff" }, // violet
    { color: "#ec4899", ink: "#ffffff" }, // pink
  ];

  function generateId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "cat_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Accepts the current object format plus both older formats this tool has
  // used (a plain array of strings; and categories/snippets from before
  // id/categoryId existed) so anyone's existing localStorage still loads.
  function normalizeEntry(item) {
    if (typeof item === "string") {
      return item ? { type: "snippet", text: item, categoryId: null } : null;
    }
    if (item && typeof item === "object" && typeof item.text === "string" && item.text) {
      if (item.type === "category" && typeof item.color === "string") {
        const ink = typeof item.ink === "string" ? item.ink : "#ffffff";
        const id = typeof item.id === "string" && item.id ? item.id : generateId();
        return { type: "category", id, text: item.text, color: item.color, ink };
      }
      const categoryId = typeof item.categoryId === "string" && item.categoryId ? item.categoryId : null;
      return { type: "snippet", text: item.text, categoryId };
    }
    return null;
  }

  // Shared by localStorage loads and file imports: normalizes every item and
  // drops dangling references to categories that no longer exist (e.g.
  // hand-edited storage, or a category removed from an imported file).
  function normalizeEntries(list) {
    const result = list.map(normalizeEntry).filter(Boolean);
    const validCategoryIds = new Set(result.filter((e) => e.type === "category").map((e) => e.id));
    result.forEach((e) => {
      if (e.type === "snippet" && e.categoryId && !validCategoryIds.has(e.categoryId)) e.categoryId = null;
    });
    return result;
  }

  function loadEntries() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return; // corrupted JSON — fall back to empty
    }
    if (!Array.isArray(stored)) return;
    entries = normalizeEntries(stored);
  }

  function saveEntries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      // storage full or unavailable (e.g. private browsing) — edits just won't persist
    }
  }

  loadEntries();

  // ---- DOM refs ----
  const clipBoard = document.getElementById("clipBoard");
  const clipModalBackdrop = document.getElementById("clipModalBackdrop");
  const clipTypeRow = document.getElementById("clipTypeRow");
  const clipTypePills = document.querySelectorAll(".clip-type-pill");
  const clipSnippetFields = document.getElementById("clipSnippetFields");
  const clipCategoryFields = document.getElementById("clipCategoryFields");
  const clipTextarea = document.getElementById("clipTextarea");
  const clipCategoryInput = document.getElementById("clipCategoryInput");
  const clipColorRow = document.getElementById("clipColorRow");
  const clipSaveBtn = document.getElementById("clipSaveBtn");
  const clipCancelBtn = document.getElementById("clipCancelBtn");
  const clipDeleteBtn = document.getElementById("clipDeleteBtn");
  const clipExportBtn = document.getElementById("clipExportBtn");
  const clipImportBtn = document.getElementById("clipImportBtn");
  const clipImportInput = document.getElementById("clipImportInput");

  let modalType = "snippet";
  let modalColor = CATEGORY_COLORS[0];

  // navigator.clipboard requires a secure context; execCommand is the
  // fallback for anything older (or a plain http:// deployment).
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function handleCopy(squareEl, text) {
    copyText(text).then(() => {
      // remove/reflow/add so back-to-back clicks retrigger the fade instead
      // of no-op'ing on a class that's already present
      squareEl.classList.remove("copied");
      void squareEl.offsetWidth;
      squareEl.classList.add("copied");
      setTimeout(() => squareEl.classList.remove("copied"), 1000);
    }).catch(() => {
      // clipboard permission denied/unavailable — nothing else to do here
    });
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ---- drag and drop ----
  let currentDropTarget = null;
  function setDropHighlight(el) {
    if (currentDropTarget === el) return;
    clearDropHighlight();
    el.classList.add("drag-over");
    currentDropTarget = el;
  }
  function clearDropHighlight() {
    if (currentDropTarget) currentDropTarget.classList.remove("drag-over");
    currentDropTarget = null;
  }

  // categoryId: what a snippet dropped on `el` should adopt — null for the
  // uncategorized zone, a category's id for a category group.
  function attachDropTarget(el, categoryId) {
    el.addEventListener("dragover", (e) => {
      if (draggedIndex === -1) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropHighlight(el);
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      clearDropHighlight();
      if (draggedIndex === -1) return;
      const dragged = entries[draggedIndex];
      draggedIndex = -1;
      if (!dragged || dragged.type !== "snippet" || dragged.categoryId === categoryId) return;
      dragged.categoryId = categoryId;
      saveEntries();
      render();
    });
  }

  // Only snippets are draggable — categories have nowhere meaningful to go
  // (no nested categories), so leaving them undraggable avoids a pick-up
  // that visibly does nothing on drop.
  function makeSquare(i) {
    const entry = entries[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "clip-square";
    if (entry.type === "category") {
      btn.classList.add("clip-category");
      btn.style.background = entry.color;
      btn.style.borderColor = entry.color;
      btn.style.color = entry.ink;
      btn.setAttribute("aria-label", "Category: " + entry.text);
    } else {
      btn.draggable = true;
      btn.setAttribute("aria-label", "Copy: " + entry.text);
    }
    const span = document.createElement("span");
    span.className = "clip-square-text";
    span.textContent = entry.text;
    btn.appendChild(span);

    btn.addEventListener("click", () => {
      if (didDrag) {
        didDrag = false;
        return;
      }
      handleCopy(btn, entry.text);
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openModal(i);
    });
    btn.addEventListener("dragstart", (e) => {
      draggedIndex = i;
      didDrag = true;
      btn.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", entry.text);
    });
    btn.addEventListener("dragend", () => {
      btn.classList.remove("dragging");
      clearDropHighlight();
      draggedIndex = -1;
    });
    return btn;
  }

  function render() {
    clipBoard.innerHTML = "";

    const categories = entries.filter((e) => e.type === "category");
    const uncategorizedIndices = [];
    entries.forEach((e, i) => {
      if (e.type === "snippet" && !e.categoryId) uncategorizedIndices.push(i);
    });

    if (uncategorizedIndices.length > 0) {
      const grid = document.createElement("div");
      grid.className = "clip-grid";
      uncategorizedIndices.forEach((i) => grid.appendChild(makeSquare(i)));
      attachDropTarget(grid, null);
      clipBoard.appendChild(grid);
    } else if (categories.length > 0) {
      const grid = document.createElement("div");
      grid.className = "clip-grid";
      const hint = document.createElement("div");
      hint.className = "clip-empty-hint";
      hint.textContent = "Drop here to remove from a category";
      grid.appendChild(hint);
      attachDropTarget(grid, null);
      clipBoard.appendChild(grid);
    }

    categories.forEach((cat) => {
      const catIndex = entries.indexOf(cat);
      const group = document.createElement("div");
      group.className = "clip-category-group";
      group.style.background = hexToRgba(cat.color, 0.1);
      group.style.borderColor = hexToRgba(cat.color, 0.45);
      const grid = document.createElement("div");
      grid.className = "clip-grid";
      grid.appendChild(makeSquare(catIndex));
      entries.forEach((e, i) => {
        if (e.type === "snippet" && e.categoryId === cat.id) grid.appendChild(makeSquare(i));
      });
      group.appendChild(grid);
      attachDropTarget(group, cat.id);
      clipBoard.appendChild(group);
    });

    const addWrap = document.createElement("div");
    addWrap.className = "clip-grid";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "clip-square clip-add";
    addBtn.setAttribute("aria-label", "Add square");
    addBtn.textContent = "+";
    addBtn.addEventListener("click", () => openModal(-1));
    addWrap.appendChild(addBtn);
    clipBoard.appendChild(addWrap);
  }

  function renderColorSwatches() {
    clipColorRow.innerHTML = "";
    CATEGORY_COLORS.forEach((c) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "clip-color-swatch" + (c.color === modalColor.color ? " active" : "");
      sw.style.background = c.color;
      sw.setAttribute("aria-label", "Pick color " + c.color);
      sw.addEventListener("click", () => {
        modalColor = c;
        renderColorSwatches();
      });
      clipColorRow.appendChild(sw);
    });
  }

  function setModalType(type) {
    modalType = type;
    clipTypePills.forEach((btn) => btn.classList.toggle("active", btn.dataset.clipType === type));
    clipSnippetFields.hidden = type !== "snippet";
    clipCategoryFields.hidden = type !== "category";
    if (type === "category") renderColorSwatches();
  }

  clipTypePills.forEach((btn) => {
    btn.addEventListener("click", () => setModalType(btn.dataset.clipType));
  });

  function openModal(index) {
    editingIndex = index;
    const editing = index !== -1;
    const entry = editing ? entries[index] : null;
    clipTypeRow.hidden = editing; // switching type mid-edit would need a whole new field set — just delete and re-add instead
    clipDeleteBtn.hidden = !editing; // nothing to delete yet when adding

    if (editing && entry.type === "category") {
      modalColor = CATEGORY_COLORS.find((c) => c.color === entry.color) || { color: entry.color, ink: entry.ink };
      setModalType("category");
      clipCategoryInput.value = entry.text;
    } else {
      modalColor = CATEGORY_COLORS[0];
      setModalType("snippet");
      clipTextarea.value = editing ? entry.text : "";
    }

    clipModalBackdrop.hidden = false;
    const fieldToFocus = modalType === "category" ? clipCategoryInput : clipTextarea;
    fieldToFocus.focus();
    fieldToFocus.select();
  }

  function closeModal() {
    clipModalBackdrop.hidden = true;
    editingIndex = -1;
  }

  // Deleting a category un-assigns (not deletes) any snippets in it.
  function deleteEntryAt(index) {
    const removed = entries[index];
    entries.splice(index, 1);
    if (removed.type === "category") {
      entries.forEach((e) => {
        if (e.type === "snippet" && e.categoryId === removed.id) e.categoryId = null;
      });
    }
  }

  clipSaveBtn.addEventListener("click", () => {
    if (modalType === "category") {
      const text = clipCategoryInput.value.trim();
      if (editingIndex === -1) {
        if (text) entries.push({ type: "category", id: generateId(), text, color: modalColor.color, ink: modalColor.ink }); // blank + Save while adding = no-op
      } else if (text) {
        const existing = entries[editingIndex];
        entries[editingIndex] = { type: "category", id: existing.id, text, color: modalColor.color, ink: modalColor.ink };
      } else {
        deleteEntryAt(editingIndex); // saved blank on an existing square = delete it
      }
    } else {
      const text = clipTextarea.value.trim();
      if (editingIndex === -1) {
        if (text) entries.push({ type: "snippet", text, categoryId: null });
      } else if (text) {
        const existing = entries[editingIndex];
        entries[editingIndex] = { type: "snippet", text, categoryId: existing.categoryId };
      } else {
        deleteEntryAt(editingIndex);
      }
    }
    saveEntries();
    render();
    closeModal();
  });

  clipCancelBtn.addEventListener("click", closeModal);

  clipDeleteBtn.addEventListener("click", () => {
    if (editingIndex !== -1) {
      deleteEntryAt(editingIndex);
      saveEntries();
      render();
    }
    closeModal();
  });

  clipModalBackdrop.addEventListener("click", (e) => {
    if (e.target === clipModalBackdrop) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (clipModalBackdrop.hidden) return;
    if (e.key === "Escape") closeModal();
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") clipSaveBtn.click();
  });

  // ---- export / import (snippets + categories together, one JSON file) ----
  clipExportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "common-clipboard.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  clipImportBtn.addEventListener("click", () => clipImportInput.click());

  clipImportInput.addEventListener("change", () => {
    const file = clipImportInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        alert("That file isn't valid JSON.");
        return;
      }
      if (!Array.isArray(parsed)) {
        alert("That file doesn't look like a Common Clipboard export.");
        return;
      }
      if (!confirm("Import will replace everything currently on this board. Continue?")) return;
      entries = normalizeEntries(parsed);
      saveEntries();
      render();
    };
    reader.readAsText(file);
    clipImportInput.value = ""; // allow re-selecting the same file later
  });

  // ---- init ----
  render();
})();
