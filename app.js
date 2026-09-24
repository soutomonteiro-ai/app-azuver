// =========================================================================
// Painel EM 3 — app.js
// Vanilla JS + Firebase (modular SDK via CDN). Sem build step.
// =========================================================================

import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ---------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUid = null;

const connEl = document.getElementById("connStatus");

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUid = user.uid; // identificador técnico interno; nunca exibido na UI
    setConn("online");
    startListeners();
  }
});

signInAnonymously(auth).catch((err) => {
  console.error("Falha na autenticação anônima:", err);
  setConn("offline");
});

function setConn(state) {
  connEl.classList.remove("conn--connecting", "conn--online", "conn--offline");
  connEl.classList.add(`conn--${state}`);
  connEl.title =
    state === "online" ? "Conectado" :
    state === "offline" ? "Sem conexão" : "Conectando...";
}

// ---------------------------------------------------------------------
// Constantes de domínio
// ---------------------------------------------------------------------

const CELULAS = [
  { id: "d1", nome: "D-1 Pessoal", abrev: "D1" },
  { id: "d2", nome: "D-2 Inteligência", abrev: "D2" },
  { id: "d3", nome: "D-3 Operações", abrev: "D3" },
  { id: "d4", nome: "D-4 Logística", abrev: "D4" },
  { id: "d5", nome: "D-5 Planejamento", abrev: "D5" },
  { id: "d6", nome: "D-6 C2/Ciber", abrev: "D6" },
  { id: "d7d8", nome: "D-7/D-8 ComSoc/OpInfo", abrev: "D7/D8" },
  { id: "d9", nome: "D-9 Assuntos Civis", abrev: "D9" },
  { id: "d10", nome: "D-10 Finanças", abrev: "D10" }
];

const CELULA_MAP = Object.fromEntries(CELULAS.map((c) => [c.id, c]));

const URGENCIA_LABEL = {
  critico: "Crítico",
  importante: "Importante",
  informativo: "Informativo"
};

const STATUS_LABEL = {
  pendente: "Pendente",
  analise: "Em Análise",
  decisao: "Decisão Necessária",
  pronta: "Pronta / Expedida"
};

// ---------------------------------------------------------------------
// Estado local (dados em cache vindos do Firestore)
// ---------------------------------------------------------------------

let injecoesCache = [];
let simulasCache = [];

// ---------------------------------------------------------------------
// Navegação por abas
// ---------------------------------------------------------------------

const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll(".view");

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabs.forEach((t) => t.classList.toggle("tab--active", t === tab));
    views.forEach((v) => v.classList.toggle("view--active", v.id === `view-${target}`));
  });
});

// ---------------------------------------------------------------------
// Seletor global "Ver como"
// ---------------------------------------------------------------------

const VIEWAS_KEY = "painelEm3_verComo";
const viewAsSelect = document.getElementById("viewAsSelect");

function getViewAs() {
  return localStorage.getItem(VIEWAS_KEY) || "todas";
}

function setViewAs(value) {
  localStorage.setItem(VIEWAS_KEY, value);
}

viewAsSelect.value = getViewAs();
viewAsSelect.addEventListener("change", () => {
  setViewAs(viewAsSelect.value);
  renderDirex();
  renderSimulas();
});

function isCommandView(viewAs) {
  return viewAs === "todas" || viewAs === "comto";
}

// ---------------------------------------------------------------------
// Validação de formulários — mensagem de erro visível (nunca só foco
// silencioso) quando campos obrigatórios estão vazios.
// ---------------------------------------------------------------------

function buildRequiredFieldsMessage(labels) {
  if (labels.length === 1) return `Preencha ${labels[0]} antes de registrar.`;
  const allButLast = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1];
  return `Preencha ${allButLast} e ${last} antes de registrar.`;
}

// fields: [{ el, label }] em ordem de exibição no formulário.
// Retorna null se tudo válido, ou { message, firstEmptyEl } caso falte algo.
function validateRequiredFields(fields) {
  const missing = fields.filter((f) => !f.el.value.trim());
  if (missing.length === 0) return null;
  return {
    message: buildRequiredFieldsMessage(missing.map((f) => f.label)),
    firstEmptyEl: missing[0].el
  };
}

// ---------------------------------------------------------------------
// Formulário: Nova Injeção
// ---------------------------------------------------------------------

const celulasGridNova = document.getElementById("celulasGridNova");
const tplCelulaBlock = document.getElementById("tpl-celula-block");
const celulaBlockRefs = {}; // id -> { checkbox, textarea }

CELULAS.forEach((celula) => {
  const node = tplCelulaBlock.content.cloneNode(true);
  const checkbox = node.querySelector(".celula-check");
  const abrevEl = node.querySelector(".celula-block__abrev");
  const nomeEl = node.querySelector(".celula-block__nome");
  const textarea = node.querySelector(".celula-block__texto");

  abrevEl.textContent = celula.abrev;
  nomeEl.textContent = celula.nome;
  checkbox.addEventListener("change", () => {
    textarea.hidden = !checkbox.checked;
    if (!checkbox.checked) textarea.value = "";
  });

  celulaBlockRefs[celula.id] = { checkbox, textarea };
  celulasGridNova.appendChild(node);
});

const formNovaInjecao = document.getElementById("formNovaInjecao");
const novaInjecaoMsg = document.getElementById("novaInjecaoMsg");

formNovaInjecao.addEventListener("submit", async (e) => {
  e.preventDefault();
  novaInjecaoMsg.textContent = "";
  novaInjecaoMsg.classList.remove("error");

  const gdhEl = document.getElementById("inGdh");
  const origemEl = document.getElementById("inOrigem");
  const resumoEl = document.getElementById("inResumo");

  const requiredFieldsValidation = validateRequiredFields([
    { el: gdhEl, label: "o GDH" },
    { el: origemEl, label: "a Origem" },
    { el: resumoEl, label: "o resumo da situação" }
  ]);

  if (requiredFieldsValidation) {
    novaInjecaoMsg.textContent = requiredFieldsValidation.message;
    novaInjecaoMsg.classList.add("error");
    requiredFieldsValidation.firstEmptyEl.focus();
    return;
  }

  const gdh = gdhEl.value.trim();
  const origem = origemEl.value.trim();
  const autor = document.getElementById("inAutor").value.trim();
  const urgencia = formNovaInjecao.querySelector('input[name="urgencia"]:checked').value;
  const resumo = resumoEl.value.trim();

  const celulas = {};
  let algumaSelecionada = false;
  CELULAS.forEach((c) => {
    const ref = celulaBlockRefs[c.id];
    const sel = ref.checkbox.checked;
    if (sel) algumaSelecionada = true;
    celulas[c.id] = { sel, texto: sel ? ref.textarea.value.trim() : "" };
  });

  if (!algumaSelecionada) {
    novaInjecaoMsg.textContent = "Selecione ao menos uma célula para rotear.";
    novaInjecaoMsg.classList.add("error");
    return;
  }

  const submitBtn = formNovaInjecao.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, "injecoes"), {
      gdh,
      origem,
      autor,
      urgencia,
      resumo,
      celulas,
      status: "pendente",
      createdAt: serverTimestamp()
    });

    novaInjecaoMsg.textContent = "Injeção registrada e roteada.";
    formNovaInjecao.reset();
    CELULAS.forEach((c) => {
      const ref = celulaBlockRefs[c.id];
      ref.textarea.hidden = true;
      ref.textarea.value = "";
    });
    formNovaInjecao.querySelector('input[name="urgencia"][value="critico"]').checked = true;
  } catch (err) {
    console.error("Erro ao registrar injeção:", err);
    novaInjecaoMsg.textContent = "Erro ao registrar. Tente novamente.";
    novaInjecaoMsg.classList.add("error");
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------
// Injeções DIREX — listagem + filtros
// ---------------------------------------------------------------------

const direxList = document.getElementById("direxList");
const statusFilter = document.getElementById("statusFilter");

statusFilter.addEventListener("change", renderDirex);

function formatTimestamp(ts) {
  if (!ts || typeof ts.toDate !== "function") return "—";
  const d = ts.toDate();
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
}

function renderDirex() {
  const viewAs = getViewAs();
  const statusVal = statusFilter.value;

  let items = injecoesCache.slice();

  if (!isCommandView(viewAs)) {
    items = items.filter((it) => it.celulas && it.celulas[viewAs] && it.celulas[viewAs].sel);
  }
  if (statusVal !== "todos") {
    items = items.filter((it) => it.status === statusVal);
  }

  direxList.innerHTML = "";

  if (items.length === 0) {
    direxList.innerHTML = '<p class="empty-state">Nenhuma injeção encontrada para este filtro.</p>';
    return;
  }

  items.forEach((it) => {
    direxList.appendChild(buildInjecaoCard(it, viewAs));
  });
}

function buildInjecaoCard(it, viewAs) {
  const card = document.createElement("article");
  card.className = "injecao-card";
  card.dataset.urgencia = it.urgencia;

  const chipsHtml = CELULAS
    .filter((c) => it.celulas && it.celulas[c.id] && it.celulas[c.id].sel)
    .map((c) => `<span class="chip">${c.abrev}</span>`)
    .join("");

  let celulasTextoHtml = "";
  if (isCommandView(viewAs)) {
    celulasTextoHtml = CELULAS
      .filter((c) => it.celulas && it.celulas[c.id] && it.celulas[c.id].sel && it.celulas[c.id].texto)
      .map((c) => `
        <div class="celula-texto-block">
          <span class="celula-texto-block__label">${c.abrev}</span>${escapeHtml(it.celulas[c.id].texto)}
        </div>
      `).join("");
  } else {
    const cel = it.celulas && it.celulas[viewAs];
    if (cel && cel.texto) {
      celulasTextoHtml = `
        <div class="celula-texto-block">
          <span class="celula-texto-block__label">${CELULA_MAP[viewAs].abrev}</span>${escapeHtml(cel.texto)}
        </div>
      `;
    }
  }

  card.innerHTML = `
    <div class="injecao-card__head">
      <span class="pill pill--${it.urgencia}">${URGENCIA_LABEL[it.urgencia] || it.urgencia}</span>
      <span class="injecao-card__gdh mono">${escapeHtml(it.gdh || "—")}</span>
      <span class="injecao-card__origem">${escapeHtml(it.origem || "")}</span>
    </div>
    <div class="injecao-card__resumo">${escapeHtml(it.resumo || "")}</div>
    <div class="chips">${chipsHtml}</div>
    ${celulasTextoHtml}
    <div class="injecao-card__footer">
      <span class="injecao-card__autor">${it.autor ? "Autor: " + escapeHtml(it.autor) : ""} · ${formatTimestamp(it.createdAt)}</span>
      <select class="select-compact status-select" data-id="${it.id}">
        <option value="pendente" ${it.status === "pendente" ? "selected" : ""}>Pendente</option>
        <option value="analise" ${it.status === "analise" ? "selected" : ""}>Em Análise</option>
        <option value="decisao" ${it.status === "decisao" ? "selected" : ""}>Decisão Necessária</option>
        <option value="pronta" ${it.status === "pronta" ? "selected" : ""}>Pronta / Expedida</option>
      </select>
    </div>
  `;

  const statusSelect = card.querySelector(".status-select");
  statusSelect.addEventListener("change", async () => {
    const newStatus = statusSelect.value;
    try {
      await updateDoc(doc(db, "injecoes", it.id), { status: newStatus });
    } catch (err) {
      console.error("Erro ao atualizar status:", err);
      statusSelect.value = it.status;
    }
  });

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Súmulas de Reunião
// ---------------------------------------------------------------------

const impactosList = document.getElementById("impactosList");
const btnAddImpacto = document.getElementById("btnAddImpacto");
const formSimula = document.getElementById("formSimula");
const simulaMsg = document.getElementById("simulaMsg");
const simulasListEl = document.getElementById("simulasList");

function buildImpactoRow() {
  const row = document.createElement("div");
  row.className = "impacto-row";

  const select = document.createElement("select");
  CELULAS.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.abrev} — ${c.nome}`;
    select.appendChild(opt);
  });

  const textarea = document.createElement("textarea");
  textarea.rows = 1;
  textarea.placeholder = "Impacto para esta célula...";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "impacto-row__remove";
  removeBtn.textContent = "remover";
  removeBtn.addEventListener("click", () => row.remove());

  row.appendChild(select);
  row.appendChild(textarea);
  row.appendChild(removeBtn);
  return row;
}

btnAddImpacto.addEventListener("click", () => {
  impactosList.appendChild(buildImpactoRow());
});

// Começa com uma linha de impacto pronta
impactosList.appendChild(buildImpactoRow());

formSimula.addEventListener("submit", async (e) => {
  e.preventDefault();
  simulaMsg.textContent = "";
  simulaMsg.classList.remove("error");

  const reuniaoEl = document.getElementById("simReuniao");
  const gdhEl = document.getElementById("simGdh");
  const decisaoEl = document.getElementById("simDecisao");

  const requiredFieldsValidation = validateRequiredFields([
    { el: reuniaoEl, label: "a Reunião" },
    { el: gdhEl, label: "o GDH" },
    { el: decisaoEl, label: "a Decisão-chave" }
  ]);

  if (requiredFieldsValidation) {
    simulaMsg.textContent = requiredFieldsValidation.message;
    simulaMsg.classList.add("error");
    requiredFieldsValidation.firstEmptyEl.focus();
    return;
  }

  const reuniao = reuniaoEl.value.trim();
  const gdh = gdhEl.value.trim();
  const decisao = decisaoEl.value.trim();
  const autor = document.getElementById("simAutor").value.trim();

  const impactos = [];
  impactosList.querySelectorAll(".impacto-row").forEach((row) => {
    const celula = row.querySelector("select").value;
    const texto = row.querySelector("textarea").value.trim();
    if (texto) impactos.push({ celula, texto });
  });

  const submitBtn = formSimula.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, "simulas"), {
      reuniao,
      gdh,
      decisao,
      autor,
      impactos,
      createdAt: serverTimestamp()
    });

    simulaMsg.textContent = "Súmula registrada.";
    formSimula.reset();
    impactosList.innerHTML = "";
    impactosList.appendChild(buildImpactoRow());
  } catch (err) {
    console.error("Erro ao registrar súmula:", err);
    simulaMsg.textContent = "Erro ao registrar. Tente novamente.";
    simulaMsg.classList.add("error");
  } finally {
    submitBtn.disabled = false;
  }
});

function renderSimulas() {
  const viewAs = getViewAs();
  let items = simulasCache.slice();

  if (!isCommandView(viewAs)) {
    items = items.filter((s) => (s.impactos || []).some((imp) => imp.celula === viewAs));
  }

  simulasListEl.innerHTML = "";

  if (items.length === 0) {
    simulasListEl.innerHTML = '<p class="empty-state">Nenhuma súmula encontrada para este filtro.</p>';
    return;
  }

  items.forEach((s) => {
    simulasListEl.appendChild(buildSimulaCard(s, viewAs));
  });
}

function buildSimulaCard(s, viewAs) {
  const card = document.createElement("article");
  card.className = "simula-card";

  let impactos = s.impactos || [];
  if (!isCommandView(viewAs)) {
    impactos = impactos.filter((imp) => imp.celula === viewAs);
  }

  const impactosHtml = impactos.map((imp) => `
    <div class="impacto-item">
      <span class="impacto-item__celula mono">${CELULA_MAP[imp.celula] ? CELULA_MAP[imp.celula].abrev : imp.celula}</span>
      <span>${escapeHtml(imp.texto)}</span>
    </div>
  `).join("");

  card.innerHTML = `
    <div class="simula-card__head">
      <span class="simula-card__reuniao">${escapeHtml(s.reuniao || "")}</span>
      <span class="simula-card__gdh mono">${escapeHtml(s.gdh || "—")}</span>
    </div>
    <div class="simula-card__decisao">${escapeHtml(s.decisao || "")}</div>
    ${impactosHtml}
    <div class="injecao-card__footer">
      <span class="injecao-card__autor">${s.autor ? "Autor: " + escapeHtml(s.autor) : ""} · ${formatTimestamp(s.createdAt)}</span>
    </div>
  `;

  return card;
}

// ---------------------------------------------------------------------
// Painel do Comando — KPIs + Kanban
// ---------------------------------------------------------------------

const kpiTotal = document.getElementById("kpiTotal");
const kpiCriticas = document.getElementById("kpiCriticas");
const kpiPendentes = document.getElementById("kpiPendentes");
const kpiProntas = document.getElementById("kpiProntas");

const kanbanCols = {
  pendente: document.getElementById("kanbanPendente"),
  analise: document.getElementById("kanbanAnalise"),
  decisao: document.getElementById("kanbanDecisao"),
  pronta: document.getElementById("kanbanPronta")
};

function renderComando() {
  const total = injecoesCache.length;
  const criticasAbertas = injecoesCache.filter(
    (it) => it.urgencia === "critico" && it.status !== "pronta"
  ).length;
  const pendentes = injecoesCache.filter((it) => it.status === "pendente").length;
  const prontas = injecoesCache.filter((it) => it.status === "pronta").length;

  kpiTotal.textContent = total;
  kpiCriticas.textContent = criticasAbertas;
  kpiPendentes.textContent = pendentes;
  kpiProntas.textContent = prontas;

  Object.values(kanbanCols).forEach((col) => (col.innerHTML = ""));

  injecoesCache.forEach((it) => {
    const col = kanbanCols[it.status] || kanbanCols.pendente;
    col.appendChild(buildKanbanCard(it));
  });
}

function buildKanbanCard(it) {
  const card = document.createElement("div");
  card.className = "kanban-card";
  card.dataset.urgencia = it.urgencia;

  card.innerHTML = `
    <span class="kanban-card__gdh mono">${escapeHtml(it.gdh || "—")}</span>
    <div class="kanban-card__resumo">${escapeHtml(it.resumo || "")}</div>
    <select class="status-select" data-id="${it.id}">
      <option value="pendente" ${it.status === "pendente" ? "selected" : ""}>Pendente</option>
      <option value="analise" ${it.status === "analise" ? "selected" : ""}>Em Análise</option>
      <option value="decisao" ${it.status === "decisao" ? "selected" : ""}>Decisão Necessária</option>
      <option value="pronta" ${it.status === "pronta" ? "selected" : ""}>Pronta / Expedida</option>
    </select>
  `;

  const statusSelect = card.querySelector(".status-select");
  statusSelect.addEventListener("change", async () => {
    const newStatus = statusSelect.value;
    try {
      await updateDoc(doc(db, "injecoes", it.id), { status: newStatus });
    } catch (err) {
      console.error("Erro ao atualizar status:", err);
      statusSelect.value = it.status;
    }
  });

  return card;
}

// ---------------------------------------------------------------------
// Listeners Firestore (tempo real)
// ---------------------------------------------------------------------

let listenersStarted = false;

function startListeners() {
  if (listenersStarted) return;
  listenersStarted = true;

  const injecoesQuery = query(collection(db, "injecoes"), orderBy("createdAt", "desc"));
  onSnapshot(
    injecoesQuery,
    (snapshot) => {
      injecoesCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDirex();
      renderComando();
    },
    (err) => {
      console.error("Erro no listener de injeções:", err);
      setConn("offline");
    }
  );

  const simulasQuery = query(collection(db, "simulas"), orderBy("createdAt", "desc"));
  onSnapshot(
    simulasQuery,
    (snapshot) => {
      simulasCache = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderSimulas();
    },
    (err) => {
      console.error("Erro no listener de súmulas:", err);
      setConn("offline");
    }
  );
}
