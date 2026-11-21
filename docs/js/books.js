const shelvesEl = document.getElementById("shelves");
const filterEl = document.getElementById("filter");
const countEl = document.getElementById("count");
const modal = document.getElementById("modal");
const modalClose = document.getElementById("modal-close");
const modalCover = document.getElementById("modal-cover");
const modalTitle = document.getElementById("modal-title");
const modalAuthor = document.getElementById("modal-author");
const modalShelf = document.getElementById("modal-shelf");
const modalRating = document.getElementById("modal-rating");
const modalNote = document.getElementById("modal-note");
const modalLink = document.getElementById("modal-link");

function hashCode(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function shelfLabel(shelf) {
  return shelf
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function stars(rating) {
  if (!rating) return "";
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(full) + "☆".repeat(5 - full);
}

function buildBook(book) {
  const hash = hashCode(book.slug || book.title);
  const h = 215 + (hash % 3) * 25;
  const w = Math.round(h * (0.62 + ((hash >> 3) % 10) / 100));
  const d = 24 + ((hash >> 6) % 3) * 6;
  const hue = hash % 360;

  const el = document.createElement("button");
  el.type = "button";
  el.className = "book";
  el.style.setProperty("--h", `${h}px`);
  el.style.setProperty("--w", `${w}px`);
  el.style.setProperty("--d", `${d}px`);
  el.style.setProperty("--hue", `${hue}`);
  el.setAttribute("aria-label", `${book.title} by ${book.author || "unknown"}`);
  el.dataset.search = `${book.title} ${book.author || ""}`.toLowerCase();

  const front = document.createElement("span");
  front.className = "face front";
  if (book.cover) {
    const img = document.createElement("img");
    img.src = book.cover;
    img.alt = `Cover of ${book.title}`;
    img.loading = "lazy";
    front.appendChild(img);
  } else {
    const fallback = document.createElement("span");
    fallback.className = "front-fallback";
    fallback.textContent = book.title;
    front.appendChild(fallback);
  }

  const spine = document.createElement("span");
  spine.className = "face spine";
  const spineText = document.createElement("span");
  spineText.className = "spine-text";
  spineText.textContent = book.author ? `${book.title} — ${book.author}` : book.title;
  spine.appendChild(spineText);

  const back = document.createElement("span");
  back.className = "face back";
  const pages = document.createElement("span");
  pages.className = "face pages";
  const top = document.createElement("span");
  top.className = "face top";

  el.append(front, spine, back, pages, top);
  el.addEventListener("click", () => openModal(book));
  return el;
}

function buildFiller(seed) {
  const hash = hashCode(`filler-${seed}`);
  const el = document.createElement("span");
  el.className = "book filler";
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--h", `${195 + (hash % 3) * 20}px`);
  el.style.setProperty("--w", "80px");
  el.style.setProperty("--d", `${18 + ((hash >> 4) % 3) * 5}px`);
  el.style.setProperty("--hue", `${hash % 360}`);

  const front = document.createElement("span");
  front.className = "face front";
  const spine = document.createElement("span");
  spine.className = "face spine";
  const spineText = document.createElement("span");
  spineText.className = "spine-text";
  spineText.textContent = " ";
  spine.appendChild(spineText);
  const back = document.createElement("span");
  back.className = "face back";

  el.append(front, spine, back);
  return el;
}

function fillShelves() {
  const gap = 3;
  for (const row of shelvesEl.querySelectorAll(".shelf-row")) {
    row.querySelectorAll(".book.filler").forEach((filler) => filler.remove());
    let seed = 0;
    let remaining = row.clientWidth - row.scrollWidth;
    while (remaining > 20 && seed < 80) {
      const filler = buildFiller(`${row.parentElement.dataset.shelf}-${seed}`);
      row.appendChild(filler);
      remaining = row.clientWidth - row.scrollWidth;
      if (remaining <= gap) break;
      seed++;
    }
  }
}

function buildShelf(shelfName, books) {
  const section = document.createElement("section");
  section.className = "shelf";
  section.dataset.shelf = shelfName;

  const heading = document.createElement("h2");
  heading.textContent = shelfLabel(shelfName);
  const count = document.createElement("span");
  count.className = "shelf-count";
  count.textContent = ` — ${books.length} book${books.length === 1 ? "" : "s"}`;
  heading.appendChild(count);

  const row = document.createElement("div");
  row.className = "shelf-row";
  for (const book of books) {
    row.appendChild(buildBook(book));
  }

  const plank = document.createElement("div");
  plank.className = "plank";

  section.append(heading, row, plank);
  return section;
}

function groupByShelf(books) {
  const shelves = new Map();
  for (const book of books) {
    const shelf = book.shelf || "books";
    if (!shelves.has(shelf)) shelves.set(shelf, []);
    shelves.get(shelf).push(book);
  }
  return shelves;
}

function openModal(book) {
  modalTitle.textContent = book.title;
  modalAuthor.textContent = book.author ? `by ${book.author}` : "";
  modalShelf.textContent = shelfLabel(book.shelf || "books");
  modalRating.textContent = stars(book.rating);
  modalNote.textContent = book.note || "";
  modalNote.style.display = book.note ? "" : "none";
  if (book.cover) {
    modalCover.src = book.cover;
    modalCover.alt = `Cover of ${book.title}`;
    modalCover.classList.add("has-cover");
  } else {
    modalCover.removeAttribute("src");
    modalCover.classList.remove("has-cover");
  }
  if (book.goodreads) {
    modalLink.href = book.goodreads;
    modalLink.classList.remove("hidden-link");
  } else {
    modalLink.classList.add("hidden-link");
  }
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
}

function applyFilter() {
  const query = filterEl.value.trim().toLowerCase();
  let visible = 0;
  let total = 0;
  for (const section of shelvesEl.querySelectorAll(".shelf")) {
    let shelfVisible = 0;
    for (const bookEl of section.querySelectorAll(".book")) {
      total++;
      const match = !query || bookEl.dataset.search.includes(query);
      bookEl.classList.toggle("filtered-out", !match);
      if (match) {
        visible++;
        shelfVisible++;
      }
    }
    section.classList.toggle("empty", shelfVisible === 0);
  }
  countEl.textContent = query ? `${visible} of ${total} books` : `${total} books`;
  fillShelves();
}

async function load() {
  try {
    const res = await fetch("books/manifest.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const books = await res.json();
    shelvesEl.textContent = "";
    for (const [shelfName, shelfBooks] of groupByShelf(books)) {
      shelvesEl.appendChild(buildShelf(shelfName, shelfBooks));
    }
  } catch (err) {
    shelvesEl.innerHTML = `<p class="loading">could not load the library (${err.message}).</p>`;
  }
  applyFilter();
  fillShelves();
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fillShelves, 150);
});

filterEl.addEventListener("input", applyFilter);
modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});

load();
