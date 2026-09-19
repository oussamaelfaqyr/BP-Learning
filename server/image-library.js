"use strict";

const PALETTES = Object.freeze({
  violet: { id: "violet", from: "#5d2f88", to: "#8552ad" },
  teal: { id: "teal", from: "#0f766e", to: "#14b8a6" },
  bleu: { id: "bleu", from: "#1d4ed8", to: "#3b82f6" },
  ambre: { id: "ambre", from: "#b45309", to: "#f59e0b" },
  vert: { id: "vert", from: "#15803d", to: "#22c55e" },
  ardoise: { id: "ardoise", from: "#334155", to: "#64748b" },
});

const ICONS = Object.freeze({
  dialogue: { id: "dialogue", path: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-3-.4-4.2-1.1L3 20l1.1-5.3A8.5 8.5 0 1 1 21 11.5z" },
  produit: { id: "produit", path: "M3 7l9-4 9 4v10l-9 4-9-4V7zM3 7l9 4 9-4M12 11v10" },
  prix: { id: "prix", path: "M20.6 13.4L11 3H4v7l9.6 10.4a2 2 0 0 0 2.8 0l4.2-4.2a2 2 0 0 0 0-2.8zM7.5 7.5h.01" },
  soin: { id: "soin", path: "M12 21s-7.5-4.9-9.6-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.6 6c-2.1 4.1-9.6 9-9.6 9z" },
  relation: { id: "relation", path: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-6 8-6s8 2 8 6" },
  connaissance: { id: "connaissance", path: "M12 6c-2-1.5-4.5-2-7-2v14c2.5 0 5 .5 7 2 2-1.5 4.5-2 7-2V4c-2.5 0-5 .5-7 2zM12 6v14" },
  gestion: { id: "gestion", path: "M5 20v-9M12 20V4M19 20v-6" },
  vente: { id: "vente", path: "M3 17l6-6 4 4 7-7M14 8h6v6" },
});

const IMAGES = Object.freeze([
  {
    id: "pharmacie-moderne",
    title: "Pharmacie moderne",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/Pharmacie_in_Paulista_Avenue.jpg/960px-Pharmacie_in_Paulista_Avenue.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Pharmacie_in_Paulista_Avenue.jpg",
    alt: "Vitrine d’une pharmacie moderne",
    source: "Wikimedia Commons",
    license: "CC BY-SA 4.0",
  },
  {
    id: "pharmacie-interieur",
    title: "Intérieur d’officine",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/70/Castellon_pharmacy_New_Orleans_-_interior_Oct_2023.jpg/960px-Castellon_pharmacy_New_Orleans_-_interior_Oct_2023.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Castellon_pharmacy_New_Orleans_-_interior_Oct_2023.jpg",
    alt: "Intérieur d’une officine avec comptoir et rayons",
    source: "Wikimedia Commons",
    license: "CC BY-SA 2.0",
  },
  {
    id: "comptoir",
    title: "Au comptoir",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e6/Pharmacy%2C_interior%2C_cash_register%2C_scale%2C_interior_of_a_pharmacy_Fortepan_57178.jpg/960px-Pharmacy%2C_interior%2C_cash_register%2C_scale%2C_interior_of_a_pharmacy_Fortepan_57178.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Pharmacy,_interior,_cash_register,_scale,_interior_of_a_pharmacy_Fortepan_57178.jpg",
    alt: "Comptoir et balance dans une officine",
    source: "Wikimedia Commons",
    license: "CC BY-SA 3.0",
  },
  {
    id: "vitrine",
    title: "Vitrine d’officine",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/8/80/Closeup_on_La_Pharmacie_Anglaise%2C_Brussels.jpg/960px-Closeup_on_La_Pharmacie_Anglaise%2C_Brussels.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Closeup_on_La_Pharmacie_Anglaise,_Brussels.jpg",
    alt: "Détail d’une vitrine de pharmacie",
    source: "Wikimedia Commons",
    license: "CC BY-SA 4.0",
  },
  {
    id: "produits-comptoir",
    title: "Produits au comptoir",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5f/Ila%C3%A7_dolu_sepet.jpg/960px-Ila%C3%A7_dolu_sepet.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Ila%C3%A7_dolu_sepet.jpg",
    alt: "Panier de produits de pharmacie",
    source: "Wikimedia Commons",
    license: "CC0",
  },
  {
    id: "medicaments-main",
    title: "Médicament en main",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/11/Homme_qui_tient_un_m%C3%A9dicament_dans_la_main.jpg/960px-Homme_qui_tient_un_m%C3%A9dicament_dans_la_main.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Homme_qui_tient_un_m%C3%A9dicament_dans_la_main.jpg",
    alt: "Personne tenant un médicament dans la main",
    source: "Wikimedia Commons",
    license: "CC BY 4.0",
  },
  {
    id: "piluliers",
    title: "Médicaments et piluliers",
    url: "https://upload.wikimedia.org/wikipedia/commons/0/0e/Pharmaceutical_drug.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Pharmaceutical_drug.jpg",
    alt: "Médicaments et piluliers",
    source: "Wikimedia Commons",
    license: "CC BY-SA 4.0",
  },
  {
    id: "petri",
    title: "Boîtes de culture",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/02/Petri_Dishes.jpg/960px-Petri_Dishes.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Petri_Dishes.jpg",
    alt: "Boîtes de culture en laboratoire dermocosmétique",
    source: "Wikimedia Commons",
    license: "CC BY-SA 4.0",
  },
  {
    id: "plante-dermo",
    title: "Ingrédient dermocosmétique",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/3/39/Callophyllum_inophyllum_.jpg/960px-Callophyllum_inophyllum_.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Callophyllum_inophyllum_.jpg",
    alt: "Plante utilisée comme ingrédient dermocosmétique",
    source: "Wikimedia Commons",
    license: "CC BY-SA 4.0",
  },
  {
    id: "medication-pouch",
    title: "Poche de médicaments",
    url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/01/Medication_pouch.jpg/960px-Medication_pouch.jpg",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Medication_pouch.jpg",
    alt: "Poche de médicaments préparée",
    source: "Wikimedia Commons",
    license: "CC BY 4.0",
  },
]);

function resolveImage(id) {
  if (typeof id !== "string") return null;
  const image = IMAGES.find((item) => item.id === id);
  if (!image) return null;
  return { id: image.id, title: image.title, url: image.url, pageUrl: image.pageUrl, alt: image.alt, source: image.source, license: image.license };
}

function isValidThumbnail(thumbnail) {
  if (!thumbnail || typeof thumbnail !== "object") return false;
  if (typeof thumbnail.palette !== "string" || !PALETTES[thumbnail.palette]) return false;
  if (typeof thumbnail.icon !== "string" || !ICONS[thumbnail.icon]) return false;
  return typeof thumbnail.label === "string" && Boolean(thumbnail.label.trim());
}

function sanitizeThumbnail(thumbnail) {
  if (!isValidThumbnail(thumbnail)) return null;
  const palette = PALETTES[thumbnail.palette];
  const icon = ICONS[thumbnail.icon];
  return { palette: palette.id, from: palette.from, to: palette.to, icon: icon.id, iconPath: icon.path, label: thumbnail.label.trim().slice(0, 40) };
}

function imageAllowlistText() {
  return IMAGES.map((image) => `- ${image.id} : ${image.title}`).join("\n");
}

function thumbnailGuideText() {
  const palettes = Object.keys(PALETTES).join(", ");
  const icons = Object.keys(ICONS).join(", ");
  return [
    `Palettes autorisées : ${palettes}.`,
    `Icônes autorisées : ${icons}.`,
    "Le libellé est un titre très court (2 à 4 mots, en français).",
  ].join("\n");
}

module.exports = { PALETTES, ICONS, IMAGES, resolveImage, sanitizeThumbnail, imageAllowlistText, thumbnailGuideText };
