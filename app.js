/* =====================================================================
   CONFIGURAÇÃO
   ===================================================================== */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwURetMQlh4r_vNMGEoETccKx_F7-6zJ0IkfwPQ6Fmuzr1Hs1jsLORNreZPyJZqrlcCQw/exec';
const LOGO_URL   = 'https://i.ibb.co/p6D7KfHF/LOGO-CORP-Letra-Preta-Img-ID1.png';

// tipo: 1 Deslocamento | 2 Refeição | 3 Viagens/Hospedagem | 4 Diversos
const DESPESAS_MAP = {
    "Combustível":    { emoji: "⛽", tipo: 1 },
    "Estacionamento": { emoji: "🅿️", tipo: 1 },
    "Pedágio":        { emoji: "🎫", tipo: 1 },
    "Deslocamento":   { emoji: "🚕", tipo: 1 },
    "Refeição":       { emoji: "🍔", tipo: 2 },
    "Hotel":          { emoji: "🏨", tipo: 3 },
    "Viagens":        { emoji: "✈️", tipo: 3 },
    "Diversos":       { emoji: "📦", tipo: 4 }
};
const TIPOS = ['Todos', 'Geral', 'App Corp', 'Particular', 'Veic Corp', 'Veic Alugado', 'Sem Custos'];
const TIPOS_VISIVEIS = ['Todos', 'Geral'];
const DIAS = ['Todos', 7, 15, 30];

// Detecção de plataforma (precisa vir antes de qualquer uso)
const UA = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(UA);
const isMobile = () => isIOS || isAndroid;

let reembolsos = [];
let filtroTipoAtivo = 'Todos', filtroDiasAtivo = 'Todos', filtroResponsavelAtivo = 'Todos';
let editingId = null, idParaExcluir = null;
let lancAtual = 'Visita';

/* =====================================================================
   UTILITÁRIOS
   ===================================================================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = d => { const p = String(d || '').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : (d || ''); };
const hojeISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const infoEst = d => [d.estabelecimento, d.cnpj && 'CNPJ ' + d.cnpj].filter(Boolean).join(' - ');
const tipoDe = cat => (DESPESAS_MAP[cat] || DESPESAS_MAP.Diversos).tipo;

const Store = {
    get(k)    { try { return localStorage.getItem(k); } catch { return window['__' + k] || null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { window['__' + k] = v; } }
};
const usuarioAtual = () => Store.get('app_reembolso_usuario');

let sessao = JSON.parse(Store.get('app_reembolso_sessao') || 'null');

async function postSheets(payload) {
    const resp = await fetch(SCRIPT_URL, { method: 'POST', body: JSON.stringify({ ...payload, email: sessao?.email, pin: sessao?.pin }) });
    const r = await resp.clone().json().catch(() => ({}));
    if (r.auth && payload.action !== 'login') sair(r.erro);
    return resp;
}

function normalizar(r) {
    let desp = r.despesas;
    if (typeof desp === 'string') { try { desp = JSON.parse(desp); } catch { desp = []; } }
    const data = String(r.data || '').split('T')[0];
    return {
        ...r,
        id: Number(r.id),
        data,
        kmInicial: Number(r.kmInicial) || 0,
        kmFinal: Number(r.kmFinal) || 0,
        valorKm: Number(r.valorKm) || 0,
        enviadoEm: r.enviadoEm ? String(r.enviadoEm) : '',
        enviadoPara: r.enviadoPara || '',
        despesas: (desp || []).map(d => ({
            ...d,
            valor: Number(d.valor) || 0,
            tipo: Number(d.tipo) || tipoDe(d.categoria),
            data: d.data || data,
            estabelecimento: d.estabelecimento || '',
            cnpj: d.cnpj || '',
            arquivos: Array.isArray(d.arquivos) ? d.arquivos : (d.arquivoId ? [d.arquivoId] : [])
        }))
    };
}

function custoBase(r) {
    if (r.modo === 'Particular')   return Math.max(0, r.kmFinal - r.kmInicial) * r.valorKm;
    if (r.modo === 'Veic Alugado') return r.kmFinal * r.valorKm;
    return 0;
}
const totalRegistro = r => custoBase(r) + r.despesas.reduce((a, d) => a + d.valor, 0);

function quandoEnviado(r) {
    if (!r.enviadoEm) return '';
    const d = new Date(String(r.enviadoEm).replace(' ', 'T'));
    return isNaN(d) ? r.enviadoEm : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
function selo(r) {
    if (!r.enviadoEm) return '';
    const q = quandoEnviado(r);
    return `<span title="Enviado para ${esc(r.enviadoPara)} em ${esc(q)}" class="inline-flex items-center gap-1 ml-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap"><i class="fa-solid fa-paper-plane text-[8px]"></i> Enviado ${esc(q.split(',')[0])}</span>`;
}

/* =====================================================================
   CARGA DE DADOS
   ===================================================================== */
function setCloudStatus(status, text) {
    const el = $('cloudStatus');
    const estilos = {
        carregando: ['amber',   `<i class="fa-solid fa-spinner animate-spin"></i>`],
        sucesso:    ['emerald', `<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>`],
        erro:       ['red',     `<i class="fa-solid fa-circle-exclamation text-[11px]"></i>`]
    };
    const [cor, icone] = estilos[status];
    el.className = `text-[10px] bg-${cor}-50 text-${cor}-600 px-2 py-0.5 rounded-full font-semibold border border-${cor}-100 flex items-center gap-1`;
    el.innerHTML = `${icone} ${text}`;
}

async function carregarDadosDoSheets() {
    setCloudStatus('carregando', 'Conectando ao Servidor...');
    try {

        const resp = await postSheets({ action: 'list' });
        const dados = await resp.json();
        if (!Array.isArray(dados)) throw new Error(dados.erro || 'Falha');
        reembolsos = dados.map(normalizar);
        
        setCloudStatus('sucesso', 'Servidor Conectado');
        atualizarSeletorResponsaveis();
        renderizarTabela();
    } catch (e) {
        console.error(e);
        setCloudStatus('erro', 'Servidor Desconectada');
        const msg = 'Não foi possível carregar. Verifique a conexão.';
        $('tabelaBody').innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-400">${msg}</td></tr>`;
        $('listaMobile').innerHTML = `<div class="text-center py-8 text-red-400 text-xs">${msg}</div>`;
    }
}

/* =====================================================================
   FILTROS
   ===================================================================== */
const CLS_OFF = 'px-3 py-1 rounded-full font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition';
const clsOn = cor => `px-3 py-1 rounded-full font-medium border border-${cor} bg-${cor} text-white transition shadow-sm`;

function montarBotoesFiltro() {
    const btnTipo = t => `<button data-tipo="${t}" onclick="filtrarTipo('${t}')" class="${t === 'Todos' ? clsOn('orange-500') : CLS_OFF}">${t}</button>`;
    $('grupoTipo').insertAdjacentHTML('beforeend',
        TIPOS.filter(t => TIPOS_VISIVEIS.includes(t)).map(btnTipo).join('') +
        `<span id="tiposExtras" class="hidden flex-wrap items-center gap-1.5">${TIPOS.filter(t => !TIPOS_VISIVEIS.includes(t)).map(btnTipo).join('')}</span>` +
        `<button type="button" onclick="toggleTiposExtras()" title="Mais filtros" class="w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-orange-500 hover:border-orange-300 transition flex items-center justify-center">
            <i id="iconTiposExtras" class="fa-solid fa-chevron-right text-[9px] transition-transform"></i>
        </button>`);
    $('grupoDias').insertAdjacentHTML('beforeend', DIAS.map(d =>
        `<button data-dias="${d}" onclick="filtrarDias('${d}')" class="${d === 'Todos' ? clsOn('emerald-600') : CLS_OFF}">${d === 'Todos' ? 'Todos' : d + ' dias'}</button>`).join(''));
}

function toggleTiposExtras() {
    const el = $('tiposExtras'), abrir = el.classList.contains('hidden');
    el.classList.toggle('hidden', !abrir);
    el.classList.toggle('flex', abrir);
    $('iconTiposExtras').style.transform = abrir ? 'rotate(180deg)' : '';
}

function filtrarTipo(t) {
    filtroTipoAtivo = t;
    document.querySelectorAll('[data-tipo]').forEach(b => b.className = b.dataset.tipo === t ? clsOn('orange-500') : CLS_OFF);
    renderizarTabela();
}
function filtrarDias(d) {
    filtroDiasAtivo = d === 'Todos' ? 'Todos' : Number(d);
    document.querySelectorAll('[data-dias]').forEach(b => b.className = b.dataset.dias === String(d) ? clsOn('emerald-600') : CLS_OFF);
    renderizarTabela();
}
function filtrarResponsavel(n) { filtroResponsavelAtivo = n; renderizarTabela(); }

function atualizarSeletorResponsaveis() {
    const sel = $('filtroResponsavel');
    const nomes = [...new Set(reembolsos.map(r => r.responsavel).filter(Boolean))].sort();
    const alvo = nomes.includes(filtroResponsavelAtivo) ? filtroResponsavelAtivo : 'Todos';
    sel.innerHTML = '<option value="Todos">Todos os Responsáveis</option>' +
        nomes.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = filtroResponsavelAtivo = alvo;
}

function obterItensFiltrados() {
    const limite = filtroDiasAtivo === 'Todos' ? null : new Date(Date.now() - filtroDiasAtivo * 864e5).toISOString().slice(0, 10);
    return reembolsos.filter(r =>
        (filtroTipoAtivo === 'Todos' || r.modo === filtroTipoAtivo) &&
        (!limite || r.data >= limite) &&
        (filtroResponsavelAtivo === 'Todos' || r.responsavel === filtroResponsavelAtivo)
    ).sort((a, b) => b.data.localeCompare(a.data));
}

/* =====================================================================
   LISTAGEM
   ===================================================================== */
function badgeModo(modo) {
    const m = {
        'Geral':      ['emerald', 'fa-calendar-days', 'Geral'],
        'Veic Corp':  ['blue',    'fa-car',           'Veic Corp'],
        'App Corp':   ['violet',  'fa-mobile-screen', 'App Corp'],
        'Sem Custos': ['slate',   'fa-ban',           'Sem Custos']
    }[modo] || ['slate', 'fa-ban', modo];
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-${m[0]}-50 text-${m[0]}-700 border border-${m[0]}-100"><i class="fa-solid ${m[1]} text-[9px]"></i> ${m[2]}</span>`;
}

const mqMobile = matchMedia('(max-width: 767px)');
mqMobile.addEventListener('change', () => renderizarTabela());

function renderizarTabela() {
    const marcados = new Set(idsSelecionados());
    const lista = obterItensFiltrados();
    const body = $('tabelaBody'), cards = $('listaMobile');
    body.innerHTML = cards.innerHTML = '';
    const vazio = 'Nenhum reembolso cadastrado com os filtros aplicados.';

    const dados = r => {
        const total = totalRegistro(r), geral = r.modo === 'Geral';
        return {
            geral,
            custo: (geral || r.modo === 'Particular' || r.modo === 'Veic Alugado' || total > 0) ? brl(total) : badgeModo(r.modo),
            cliente: (geral ? `${badgeModo('Geral')} <span class="text-[10px] text-slate-400 ml-1">${r.despesas.length} despesa(s)</span>` : esc(r.cliente)) + selo(r)
        };
    };
    const chk = r => `<input type="checkbox" data-id="${r.id}" ${marcados.has(r.id) ? 'checked' : ''} onchange="atualizarContadoresLote()" class="item-checkbox w-4 h-4 rounded border-slate-300 text-indigo-600 cursor-pointer">`;
    const acoes = r => `
        <button onclick="verDetalhes(${r.id})" class="text-[11px] text-indigo-600 hover:underline font-semibold">🔍 Ver detalhes</button>
        <span class="text-slate-200">|</span>
        <button onclick="editarRegistro(${r.id})" class="text-slate-400 hover:text-indigo-600 p-1.5"><i class="fa-regular fa-pen-to-square text-[14px]"></i></button>
        <button onclick="deletarRegistro(${r.id})" class="text-slate-400 hover:text-red-500 p-1.5"><i class="fa-regular fa-trash-can text-[14px]"></i></button>`;

    if (mqMobile.matches) {
        cards.innerHTML = lista.length ? lista.map(r => {
            const x = dados(r);
            return `<div class="p-4 flex gap-3 ${r.enviadoEm ? 'bg-emerald-50/40' : ''}">
                <div class="pt-0.5">${chk(r)}</div>
                <div class="flex-1 min-w-0 space-y-1">
                    <div class="flex justify-between items-start gap-2">
                        <span class="font-bold text-slate-800 text-sm">${x.cliente}</span>
                        <span class="font-extrabold text-indigo-600 text-sm whitespace-nowrap">${x.custo}</span>
                    </div>
                    <div class="text-[11px] text-slate-400">${dataBR(r.data)} • ${esc(r.responsavel)}${!x.geral && r.pontoPartida ? ' • ' + esc(r.pontoPartida) : ''}</div>
                    <div class="flex items-center gap-2 pt-1">${acoes(r)}</div>
                </div>
            </div>`;
        }).join('') : `<div class="text-center py-8 text-slate-400 text-xs">${vazio}</div>`;
    } else {
        body.innerHTML = lista.length ? lista.map(r => {
            const x = dados(r);
            return `<tr class="hover:bg-slate-50/50 transition ${r.enviadoEm ? 'bg-emerald-50/40' : ''}">
                <td class="py-3 px-5 text-center">${chk(r)}</td>
                <td class="py-3 px-3 text-slate-500">${dataBR(r.data)}</td>
                <td class="py-3 px-3 text-slate-600 font-semibold">${esc(r.pontoPartida) || '—'}</td>
                <td class="py-3 px-3 font-bold text-slate-800">${x.cliente}</td>
                <td class="py-3 px-3 text-slate-400">${esc(r.responsavel)}</td>
                <td class="py-3 px-4 text-right font-bold text-indigo-600">${x.custo}</td>
                <td class="py-3 px-4"><div class="flex items-center justify-center gap-3">${acoes(r)}</div></td>
            </tr>`;
        }).join('') : `<tr><td colspan="7" class="text-center py-8 text-slate-400">${vazio}</td></tr>`;
    }
    atualizarContadoresLote();
}

function toggleSelectAll(master) {
    document.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = master.checked);
    atualizarContadoresLote();
}

function atualizarContadoresLote() {
    const todos = document.querySelectorAll('.item-checkbox').length;
    const sel = document.querySelectorAll('.item-checkbox:checked').length;
    $('contadorTotal').innerText = todos;
    $('contadorSelecionados').innerText = sel;
    $('btnLimparTexto').innerText = sel ? 'Limpar Selecionados' : 'Limpar Lista';
    $('selectAll').checked = $('selectAllMobile').checked = todos > 0 && sel === todos;
}
function idsSelecionados() {
    return [...document.querySelectorAll('.item-checkbox:checked')].map(cb => Number(cb.dataset.id));
}

function avisoSelecionar() {
    mostrarResultado('info', 'Nenhum reembolso selecionado', 'Marque na lista os reembolsos que deseja exportar ou enviar.');
    document.querySelectorAll('.item-checkbox').forEach(cb => {
        cb.classList.add('ring-4', 'ring-amber-300');
        setTimeout(() => cb.classList.remove('ring-4', 'ring-amber-300'), 2500);
    });
}

/* =====================================================================
   EXCLUSÃO
   ===================================================================== */
async function limparListaOuSelecionados() {
    const ids = idsSelecionados();
      if (!ids.length && !sessao?.admin) return avisoSelecionar();
    const msg = ids.length ? `Remover os ${ids.length} lançamentos selecionados do Servidor?` : 'Apagar TODOS os registros do Servidor?';
    if (!confirm(msg)) return;
    const btn = $('btnLimpar');
    btn.disabled = true;
    setCloudStatus('carregando', 'Excluindo...');
    try { await postSheets(ids.length ? { action: 'deleteSelected', ids } : { action: 'clearAll' }); }
    catch { alert('Erro ao conectar ao Servidor.'); }
    await carregarDadosDoSheets();
    btn.disabled = false;
}

function deletarRegistro(id) { idParaExcluir = id; $('modalConfirmacaoExcluir').classList.remove('hidden'); }

async function confirmarExclusao() {
    if (idParaExcluir === null) return;
    const id = idParaExcluir;
    fecharModal('modalConfirmacaoExcluir');
    setCloudStatus('carregando', 'Excluindo...');
    try { await postSheets({ action: 'delete', id }); } catch {}
    await carregarDadosDoSheets();
}

function fecharModal(id) {
    $(id).classList.add('hidden');
    if (id === 'modalConfirmacaoExcluir') idParaExcluir = null;
}

/* =====================================================================
   DETALHES
   ===================================================================== */
function verDetalhes(id) {
    const r = reembolsos.find(x => x.id === Number(id));
    if (!r) return;
    const geral = r.modo === 'Geral';

    $('detalhePontoPartida').innerText = geral ? 'Reembolso Geral' : (r.pontoPartida || 'Não especificado');
    $('detalheCliente').innerText = geral ? `${r.despesas.length} despesa(s)` : r.cliente;
    $('detalheResponsavel').innerText = r.responsavel;
    $('detalheIniciais').innerText = String(r.responsavel || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    $('detalheData').innerText = dataBR(r.data);
    $('detalheRelatoText').innerText = r.relato || 'Nenhuma observação registrada.';
    $('detalheEnvio').innerHTML = r.enviadoEm
        ? `<div class="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 text-[11px] text-emerald-700 font-semibold">
             <i class="fa-solid fa-paper-plane"></i> Enviado em ${esc(quandoEnviado(r))}${r.enviadoPara ? ' para ' + esc(r.enviadoPara) : ''}
           </div>` : '';

    const linha = (icone, texto, valor, sub = '') =>
        `<div class="flex justify-between gap-3 border-b border-slate-100 py-1.5">
            <span><span class="flex items-center gap-1">${icone} ${texto}</span>${sub ? `<span class="block text-[10px] text-slate-400 mt-0.5">${sub}</span>` : ''}</span>
            <span class="font-bold whitespace-nowrap">${brl(valor)}</span>
        </div>`;

    let html = '';
    if (r.modo === 'Particular') {
        const km = Math.max(0, r.kmFinal - r.kmInicial);
        html += linha('<i class="fa-solid fa-car-side text-slate-400"></i>', `Quilometragem (${km} KM x ${brl(r.valorKm)})`, custoBase(r));
    } else if (r.modo === 'Veic Alugado') {
        html += linha('<i class="fa-solid fa-key text-slate-400"></i>', `Diárias (${r.kmFinal} x ${brl(r.valorKm)})`, custoBase(r));
    }
    r.despesas.forEach(d => html += linha(
        DESPESAS_MAP[d.categoria]?.emoji || '💵',
        `${esc(d.categoria)} • ${dataBR(d.data)} <span class="text-slate-400">(Tipo ${d.tipo})</span>`,
        d.valor,
        esc(infoEst(d)) + (d.arquivos.length ? '<br>' + d.arquivos.map((a, i) => linkAnexo(a, i + 1)).join(' &nbsp; ') : '')
    ));

    const total = totalRegistro(r);
    $('detalhesValoresExtras').innerHTML = html || `<div class="text-center py-2 text-slate-400">Sem custos reembolsáveis associados.</div>`;

    let cor, conteudo;
    if (geral || r.modo === 'Particular' || r.modo === 'Veic Alugado' || total > 0) {
        const rotulo = geral ? 'Geral' : r.modo === 'Particular' ? 'Particular' : r.modo === 'Veic Alugado' ? 'Veículo Alugado' : 'Despesas';
        cor = 'emerald'; conteudo = `<i class="fa-solid fa-sack-dollar"></i> Reembolso ${rotulo}: ${brl(total)}`;
    } else if (r.modo === 'Veic Corp') { cor = 'blue';   conteudo = '<i class="fa-solid fa-building-flag"></i> Veículo Corporativo'; }
    else if (r.modo === 'App Corp')    { cor = 'violet'; conteudo = '<i class="fa-solid fa-mobile-screen"></i> Aplicativo Corporativo'; }
    else                               { cor = 'slate';  conteudo = '<i class="fa-solid fa-seedling"></i> Visita Sem Custos'; }
    const badge = $('detalheBadge');
    badge.className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold shadow-sm border bg-${cor}-50 text-${cor}-700 border-${cor}-100`;
    badge.innerHTML = conteudo;

    $('modalDetalhes').classList.remove('hidden');
}

/* =====================================================================
   FORMULÁRIO
   ===================================================================== */
function setLancamento(tipo) {
    lancAtual = tipo;
    const geral = tipo === 'Geral';
    document.querySelectorAll('.tab-lanc').forEach(b => b.classList.toggle('ativo', b.dataset.lanc === tipo));
    document.querySelectorAll('.so-visita').forEach(el => el.classList.toggle('hidden', geral));
    $('formPontoPartida').required = !geral;
    $('formCliente').required = !geral;
    $('lblData').innerText = geral ? 'Data de Fechamento' : 'Data da Visita';
    $('dicaLanc').innerText = geral
        ? 'Despesas do mês sem cliente específico. Cada despesa tem sua própria data.'
        : 'Todos os gastos abaixo são vinculados a este cliente.';
    ajustarCamposTransporte();
}

function abrirModalForm() {
    if (editingId === null) {
        $('reembolsoForm').reset();
        $('modalTitulo').innerHTML = `<i class="fa-solid fa-circle-dollar-to-slot text-indigo-600"></i> <span>Gestão de Custos & Reembolso</span>`;
        $('btnSalvarTexto').innerText = 'Salvar Reembolso';
        $('containerDespesas').innerHTML = '';
        $('formData').value = hojeISO();
        $('formResponsavel').value = filtroResponsavelAtivo !== 'Todos' ? filtroResponsavelAtivo : (usuarioAtual() || '');
        setLancamento('Visita');
    }
    $('ocrStatus').innerHTML = '';
    $('modalForm').classList.remove('hidden');
}

function fecharModalForm() { $('modalForm').classList.add('hidden'); editingId = null; }

function editarRegistro(id) {
    const r = reembolsos.find(x => x.id === Number(id));
    if (!r) return;
    editingId = r.id;
    $('reembolsoForm').reset();
    $('containerDespesas').innerHTML = '';

    $('modalTitulo').innerHTML = `<i class="fa-solid fa-pen-to-square text-indigo-600"></i> <span>Editar Custos & Reembolso</span>`;
    $('btnSalvarTexto').innerText = 'Atualizar Reembolso';
    $('formPontoPartida').value = r.pontoPartida || '';
    $('formCliente').value = r.modo === 'Geral' ? '' : (r.cliente || '');
    $('formData').value = r.data;
    $('formResponsavel').value = r.responsavel || '';
    $('formRelato').value = r.relato || '';
    if (r.modo !== 'Geral') $('formModo').value = r.modo;

    const alugado = r.modo === 'Veic Alugado';
    $('formKmInicial').value   = r.modo === 'Particular' ? r.kmInicial : 0;
    $('formKmFinal').value     = r.modo === 'Particular' ? r.kmFinal : 0;
    $('formValorKm').value     = r.modo === 'Particular' ? (r.valorKm || 1.5) : 1.5;
    $('formQtdDiarias').value  = alugado ? (r.kmFinal || 1) : 1;
    $('formValorDiaria').value = alugado ? r.valorKm : 0;

    r.despesas.forEach(d => adicionarDespesaPrevia(d));
    setLancamento(r.modo === 'Geral' ? 'Geral' : 'Visita');
    $('ocrStatus').innerHTML = '';
    $('modalForm').classList.remove('hidden');
}

function ajustarCamposTransporte() {
    const modo = lancAtual === 'Geral' ? 'Geral' : $('formModo').value;
    $('secaoKM').className = modo === 'Particular' ? 'space-y-2 pt-2 border-t border-dashed border-slate-100' : 'hidden';
    $('secaoAluguel').className = modo === 'Veic Alugado' ? 'pt-2 border-t border-dashed border-slate-100' : 'hidden';
    calcularGeral();
}

function adicionarDespesaPrevia(d = {}) {
    const categoria = DESPESAS_MAP[d.categoria] ? d.categoria : 'Diversos';
    const opcoes = Object.entries(DESPESAS_MAP)
        .map(([k, v]) => `<option value="${k}" ${k === categoria ? 'selected' : ''}>${v.emoji} ${k}</option>`).join('');

    const div = document.createElement('div');
    div.className = 'desp-row bg-slate-50/50 p-2 rounded-xl border border-slate-100 space-y-1.5';
    div.innerHTML = `
        <div class="grid grid-cols-6 sm:grid-cols-12 gap-1.5 items-center">
            <select onchange="this.closest('.desp-row').querySelector('.badge-tipo').innerText = 'T' + tipoDe(this.value)" class="despesa-cat mini col-span-4">${opcoes}</select>
            <span class="badge-tipo col-span-1 text-center py-0.5 rounded-md text-[10px] font-extrabold bg-indigo-50 text-indigo-600 border border-indigo-100">T${tipoDe(categoria)}</span>
            <button type="button" onclick="this.closest('.desp-row').remove(); calcularGeral()" class="col-span-1 sm:order-last text-slate-400 hover:text-red-500 py-1"><i class="fa-solid fa-xmark text-sm"></i></button>
            <input type="date" value="${esc(d.data || $('formData').value || hojeISO())}" class="despesa-data mini col-span-3">
            <input type="number" step="0.01" inputmode="decimal" value="${Number(d.valor) || 0}" oninput="this.closest('.desp-row').classList.remove('ring-2','ring-amber-400'); calcularGeral()" class="despesa-val mini col-span-3 text-right font-bold">
        </div>
        <div class="grid grid-cols-12 gap-1.5">
            <input type="text" value="${esc(d.estabelecimento)}" placeholder="Nome do estabelecimento" class="despesa-est mini col-span-12 sm:col-span-7">
            <input type="text" value="${esc(d.cnpj)}" placeholder="CNPJ" onblur="validarCnpjCampo(this)" class="despesa-cnpj mini col-span-12 sm:col-span-5">
        </div>
        <div class="flex flex-wrap items-center gap-1.5 text-[10px]">
            <div class="anexos flex flex-wrap gap-1.5"></div>
            <label class="cursor-pointer inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 font-semibold transition">
                <i class="fa-solid fa-paperclip"></i> <span class="txt-anexo">Adicionar comprovante</span>
                <input type="file" accept="image/*,application/pdf" multiple class="hidden" onchange="anexarComprovante(this)">
            </label>
        </div>`;
    renderAnexos(div, d.arquivos || []);
    $('containerDespesas').appendChild(div);
    calcularGeral();
    return div;
}

function validarCnpjCampo(el) {
    const v = el.value.trim(), ruim = !!v && !cnpjValido(v);
    el.classList.toggle('!border-red-400', ruim);
    el.title = ruim ? 'CNPJ inválido' : '';
}

function calcularGeral() {
    const modo = lancAtual === 'Geral' ? 'Geral' : $('formModo').value;
    const km = Math.max(0, (+$('formKmFinal').value || 0) - (+$('formKmInicial').value || 0));
    const qtd = parseInt($('formQtdDiarias').value) || 0;
    const aluguel = qtd * (+$('formValorDiaria').value || 0);

    $('formKmTotal').innerText = km;
    $('formTotalAluguel').innerText = brl(aluguel);

    let transporte = 0;
    if (modo === 'Particular') transporte = km * (+$('formValorKm').value || 0);
    if (modo === 'Veic Alugado') transporte = aluguel;

    const vals = [...document.querySelectorAll('#containerDespesas .despesa-val')];
    const extras = vals.reduce((a, i) => a + (+i.value || 0), 0);

    $('resumoAcumulado').innerText =
        modo === 'Particular'   ? `${km} KM rodados • ${brl(extras)} extras` :
        modo === 'Veic Alugado' ? `${qtd} Diárias • ${brl(extras)} extras` :
                                  `${vals.length} despesa(s) • ${brl(extras)}`;
    $('valorTotalAcumulado').innerText = brl(transporte + extras);

    const tem = vals.length > 0;
    $('btnLerPrincipal').classList.toggle('hidden', tem);
    $('btnManualInicial').classList.toggle('hidden', tem);
    $('acoesDespesa').classList.toggle('hidden', !tem);
}

async function salvarReembolso(e) {
    e.preventDefault();
    const geral = lancAtual === 'Geral';
    const modo = geral ? 'Geral' : $('formModo').value;
    const responsavel = $('formResponsavel').value.trim();

    const despesas = [];
    document.querySelectorAll('#containerDespesas .desp-row').forEach(row => {
        const categoria = row.querySelector('.despesa-cat').value;
        const valor = +row.querySelector('.despesa-val').value || 0;
        if (valor > 0) despesas.push({
            id: Date.now() + Math.random(),
            categoria, tipo: tipoDe(categoria), valor,
            data: row.querySelector('.despesa-data').value || $('formData').value,
            estabelecimento: row.querySelector('.despesa-est').value.trim(),
            cnpj: row.querySelector('.despesa-cnpj').value.trim(),
            arquivos: getAnexos(row)
        });
    });
    if (geral && !despesas.length) return alert('Adicione ao menos uma despesa no reembolso geral.');

    const antigo = editingId !== null ? reembolsos.find(x => x.id === editingId) : null;
    const registro = {
        id: editingId ?? Date.now(),
        data: $('formData').value,
        pontoPartida: geral ? '' : $('formPontoPartida').value.trim(),
        cliente: geral ? 'Reembolso Geral' : $('formCliente').value.trim(),
        relato: $('formRelato').value.trim(),
        responsavel, modo,
        kmInicial: 0, kmFinal: 0, valorKm: 0,
        despesas,
        enviadoEm: antigo?.enviadoEm || '',
        enviadoPara: antigo?.enviadoPara || ''
    };
    if (modo === 'Particular') {
        registro.kmInicial = +$('formKmInicial').value || 0;
        registro.kmFinal   = +$('formKmFinal').value || 0;
        registro.valorKm   = +$('formValorKm').value || 0;
    } else if (modo === 'Veic Alugado') {
        registro.kmFinal = parseInt($('formQtdDiarias').value) || 0;
        registro.valorKm = +$('formValorDiaria').value || 0;
    }

    const btn = $('btnSalvar');
    btn.disabled = true;
    $('btnSalvarTexto').innerText = 'Enviando...';
    $('salvarIcon').className = 'fa-solid fa-spinner animate-spin text-[10px]';
    Store.set('app_reembolso_usuario', responsavel);

    try {
        const resp = await postSheets({ action: 'save', record: registro });
        const r = await resp.json().catch(() => ({}));
        if (r.erro) throw new Error(r.erro);
        fecharModalForm();
        await carregarDadosDoSheets();
    } catch (err) {
        alert('Erro ao salvar no Google Sheets: ' + (err.message || 'verifique a conexão.'));
    } finally {
        btn.disabled = false;
        $('btnSalvarTexto').innerText = editingId !== null ? 'Atualizar Reembolso' : 'Salvar Reembolso';
        $('salvarIcon').className = 'fa-solid fa-floppy-disk text-[10px]';
    }
}

/* =====================================================================
   LEITURA DE COMPROVANTE (Gemini via Apps Script)
   ===================================================================== */
function ocrMsg(html, tipo) {
    const cores = { info: 'text-slate-500', ok: 'text-emerald-600', alerta: 'text-amber-600', erro: 'text-red-600' };
    $('ocrStatus').className = `text-[11px] font-semibold ${cores[tipo]}`;
    $('ocrStatus').innerHTML = html;
}

function prepararArquivo(file) {
    return new Promise((res, rej) => {
        if (file.type === 'application/pdf') {
            const fr = new FileReader();
            fr.onload = () => res({ mime: file.type, b64: fr.result.split(',')[1] });
            fr.onerror = rej;
            fr.readAsDataURL(file);
            return;
        }
        const img = new Image();
        img.onload = () => {
            const s = Math.min(1, 1600 / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width = img.width * s; c.height = img.height * s;
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(img.src);
            res({ mime: 'image/jpeg', b64: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
        };
        img.onerror = () => rej(new Error('imagem inválida'));
        img.src = URL.createObjectURL(file);
    });
}

// CNPJ numérico e alfanumérico
function cnpjValido(cnpj) {
    const c = String(cnpj || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{12}\d{2}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
    const dv = n => {
        let s = 0, p = n - 7;
        for (let i = 0; i < n; i++) { s += (c.charCodeAt(i) - 48) * p--; if (p < 2) p = 9; }
        const r = s % 11;
        return r < 2 ? 0 : 11 - r;
    };
    return dv(12) === +c[12] && dv(13) === +c[13];
}

async function lerComprovante(input) {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return ocrMsg('❌ Arquivo acima de 10 MB', 'erro');
    ocrMsg('<i class="fa-solid fa-spinner animate-spin"></i> Lendo comprovante... (isso pode levar até 30s)', 'info');
    try {
        const { mime, b64 } = await prepararArquivo(file);
        const r = await (await postSheets({ action: 'ocr', mime, data: b64 })).json();
        if (r.erro) {
            if (r.arquivoId) adicionarDespesaPrevia({ arquivos: [r.arquivoId] });
            throw new Error(r.erro);
        }
        aplicarDespesa(r);
    } catch (e) {
        ocrMsg(`❌ Não foi possível ler (${esc(e.message)}). Preencha manualmente.`, 'erro');
    }
}

function aplicarDespesa(r) {
    const alertas = [];
    const cat = DESPESAS_MAP[r.categoria] ? r.categoria : 'Diversos';
    const valor = Number(r.valor) || 0;
    if (!(valor > 0)) alertas.push('valor');

    let data = $('formData').value;
    if (r.data && /^\d{4}-\d{2}-\d{2}$/.test(r.data)) {
        data = r.data;
        const dias = (Date.now() - new Date(r.data + 'T12:00')) / 864e5;
        if (dias < -1 || dias > 90) alertas.push(`data ${dataBR(r.data)} fora do período (90 dias)`);
        else if (lancAtual === 'Visita' && r.data !== $('formData').value) alertas.push(`data do cupom ${dataBR(r.data)} diferente da visita`);
    } else alertas.push('data');

    if (r.cnpj && !cnpjValido(r.cnpj)) alertas.push('CNPJ');
    if (Number(r.confianca) < 0.8) alertas.push('leitura incerta');

    const linha = adicionarDespesaPrevia({
        categoria: cat, valor: valor.toFixed(2), data,
        estabelecimento: r.estabelecimento || '', cnpj: r.cnpj || '',
        arquivos: r.arquivoId ? [r.arquivoId] : []
    });
    validarCnpjCampo(linha.querySelector('.despesa-cnpj'));

    if (alertas.length) {
        linha.classList.add('ring-2', 'ring-amber-400');
        ocrMsg(`⚠️ Confira: ${esc(alertas.join(', '))}`, 'alerta');
    } else {
        ocrMsg(`✅ ${esc(r.estabelecimento || 'Comprovante')}: ${brl(valor)}`, 'ok');
    }
}

/* =====================================================================
   COMPROVANTES (Google Drive)
   ===================================================================== */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const urlArquivo = id => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
const linkAnexo = (id, n = '') => `<a href="${urlArquivo(id)}" target="_blank" rel="noopener" class="text-emerald-600 font-bold hover:underline"><i class="fa-solid fa-file-circle-check"></i> Comprovante ${n}</a>`;
const getAnexos = row => { try { return JSON.parse(row.dataset.arquivos || '[]'); } catch { return []; } };

function renderAnexos(row, ids) {
    row.dataset.arquivos = JSON.stringify(ids);
    row.querySelector('.anexos').innerHTML = ids.map((id, i) => `
        <span class="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 font-bold">
            <a href="${urlArquivo(id)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-circle-check"></i> Comprovante ${i + 1}</a>
            <button type="button" onclick="removerAnexo(this, ${i})" title="Remover" class="w-4 h-4 rounded hover:bg-emerald-100 flex items-center justify-center"><i class="fa-solid fa-xmark text-[9px]"></i></button>
        </span>`).join('');
}

function removerAnexo(btn, i) {
    const row = btn.closest('.desp-row'), ids = getAnexos(row);
    ids.splice(i, 1);
    renderAnexos(row, ids);
}

async function anexarComprovante(input) {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const row = input.closest('.desp-row'), txt = row.querySelector('.txt-anexo'), ids = getAnexos(row);
    for (const [i, file] of files.entries()) {
        if (file.size > 10 * 1024 * 1024) { mostrarResultado('erro', 'Arquivo muito grande', `${file.name} passa de 10 MB.`); continue; }
        txt.innerText = `Enviando ${i + 1}/${files.length}...`;
        try {
            const { mime, b64 } = await prepararArquivo(file);
            const r = await (await postSheets({ action: 'upload', mime, data: b64 })).json();
            if (r.erro) throw new Error(r.erro);
            ids.push(r.arquivoId);
            renderAnexos(row, ids);
        } catch (e) { mostrarResultado('erro', 'Falha ao anexar', e.message); }
    }
    txt.innerText = 'Adicionar comprovante';
}

/* =====================================================================
   EXPORTAÇÃO EXCEL (somente selecionados)
   ===================================================================== */
function imagemParaBase64(url) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            res(c.toDataURL('image/png'));
        };
        img.onerror = rej;
        img.src = url;
    });
}

async function gerarExcel() {
    const marcados = idsSelecionados();
    if (!marcados.length) return null;
    const itens = reembolsos.filter(r => marcados.includes(r.id)).sort((a, b) => a.data.localeCompare(b.data));
    if (!itens.length) return null;

    const FINO = { style: 'thin', color: { argb: 'FF000000' } };
    const MEDIO = { style: 'medium', color: { argb: 'FF000000' } };
    const BORDA = { top: FINO, bottom: FINO, left: FINO, right: FINO };
    const PRETO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
    const FONTE_BRANCA = size => ({ name: 'Arial', size, bold: true, color: { argb: 'FFFFFFFF' } });
    const MOEDA = '"R$ " #,##0.00';

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reembolso', { views: [{ showGridLines: true }] });
    ws.columns = [3, 12, 20, 24, 16, 38, 12, 12, 7, 14].map(width => ({ width }));

    const soGeral = itens.every(v => v.modo === 'Geral');
    ws.mergeCells('B1:J3');
    const titulo = ws.getCell('B1');
    titulo.value = soGeral ? 'SOLICITAÇÃO DE REEMBOLSO GERAL' : 'SOLICITAÇÃO DE REEMBOLSO COMERCIAL';
    titulo.font = { name: 'Arial', size: 16, bold: true };
    titulo.alignment = { vertical: 'middle', horizontal: 'center' };
    for (let r = 1; r <= 3; r++) for (let c = 2; c <= 10; c++) {
        ws.getCell(r, c).border = {
            top: r === 1 ? MEDIO : undefined, bottom: r === 3 ? MEDIO : undefined,
            left: c === 2 ? MEDIO : undefined, right: c === 10 ? MEDIO : undefined
        };
    }

    try {
        const logo = await imagemParaBase64(LOGO_URL);
        ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), { tl: { col: 1.1, row: 0.2 }, ext: { width: 90, height: 42 } });
    } catch { console.warn('Logo indisponível, exportando sem logo.'); }

    ws.getRow(4).height = 15;
    const heads = { 2: 'DATA', 3: 'PONTO DE PARTIDA', 4: 'VISITA', 5: 'DESCRIÇÃO', 6: 'ESTABELECIMENTO / CNPJ', 7: 'KM/DIÁRIAS', 8: 'VALOR UNIT', 9: 'TIPO', 10: 'R$' };
    const hRow = ws.getRow(5);
    hRow.height = 24;
    for (let c = 2; c <= 10; c++) {
        const cell = hRow.getCell(c);
        cell.value = heads[c];
        cell.fill = PRETO; cell.font = FONTE_BRANCA(9); cell.border = BORDA;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }

    const linhas = [];
    itens.forEach((v, i) => {
        const geral = v.modo === 'Geral';
        const base = { fill: i % 2 ? 'FFF4F6F9' : 'FFFFFFFF', data: v.data, partida: geral ? '—' : (v.pontoPartida || '—'), cliente: geral ? 'Geral' : v.cliente };
        if (v.modo === 'Particular') {
            const km = Math.max(0, v.kmFinal - v.kmInicial);
            if (km > 0) linhas.push({ ...base, desc: 'Quilometragem', qtd: km, unit: v.valorKm, tipo: 1, total: km * v.valorKm });
        } else if (v.modo === 'Veic Alugado' && custoBase(v) > 0) {
            linhas.push({ ...base, desc: `Aluguel (${v.kmFinal} Diária${v.kmFinal === 1 ? '' : 's'})`, qtd: v.kmFinal, unit: v.valorKm, tipo: 4, total: custoBase(v) });
        } else if (!geral && !v.despesas.length) {
            linhas.push({ ...base, desc: v.modo === 'Veic Alugado' ? 'Veículo Alugado' : v.modo });
        }
        v.despesas.forEach(d => linhas.push({ ...base, data: d.data || v.data, desc: d.categoria, est: infoEst(d), tipo: d.tipo, total: d.valor }));
    });

    const totalLinhas = Math.max(15, linhas.length);
    let idx = 6;
    for (let i = 0; i < totalLinhas; i++, idx++) {
        const row = ws.getRow(idx);
        row.height = 20;
        const l = linhas[i];
        if (l) {
            const vals = { 2: dataBR(l.data), 3: l.partida, 4: l.cliente, 5: l.desc, 6: l.est || '', 7: l.qtd ?? null, 8: l.unit ?? null, 9: l.tipo ?? null, 10: l.total ?? null };
            Object.entries(vals).forEach(([c, val]) => row.getCell(+c).value = val);
            row.getCell(7).numFmt = '#,##0.0';
            row.getCell(8).numFmt = MOEDA;
            row.getCell(10).numFmt = MOEDA;
        }
        for (let c = 2; c <= 10; c++) {
            const cell = row.getCell(c);
            cell.font = { name: 'Arial', size: 9 };
            cell.border = BORDA;
            cell.alignment = { vertical: 'middle', horizontal: c === 10 ? 'right' : c === 6 ? 'left' : 'center', wrapText: c === 6 };
            if (l) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: l.fill } };
        }
    }

    const ini = idx;
    ['1. = Deslocamento (Combustível, Estac., Pedágio)', '2. = Refeições', '3. = Viagens / Hotel', '4. = Diversas / Aluguel']
        .forEach((txt, i) => {
            const r = ini + i;
            ws.mergeCells(`B${r}:C${r}`);
            const cell = ws.getCell(`B${r}`);
            cell.value = txt;
            cell.font = { name: 'Arial', size: 8 };
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            const b = { left: FINO, right: FINO, top: i === 0 ? FINO : undefined, bottom: i === 3 ? FINO : undefined };
            cell.border = b;
            ws.getCell(`C${r}`).border = b;
        });

    const tr = ini + 3;
    ws.getRow(tr).height = 24;
    ws.mergeCells(`D${tr}:F${tr}`);
    const set = (col, value, numFmt) => {
        const c = ws.getCell(`${col}${tr}`);
        if (value !== undefined) c.value = value;
        if (numFmt) c.numFmt = numFmt;
        c.fill = PRETO; c.font = FONTE_BRANCA(10); c.border = BORDA;
        c.alignment = { vertical: 'middle', horizontal: 'center' };
    };
    set('D', 'TOTAL REEMBOLSO'); set('E'); set('F');
    set('G', { formula: `SUM(G6:G${ini - 1})` }, '#,##0.0');
    set('H', '');
    set('I', 'R$');
    set('J', { formula: `SUM(J6:J${ini - 1})` }, MOEDA);

    const buffer = await wb.xlsx.writeBuffer();
    const resps = [...new Set(itens.map(r => r.responsavel).filter(Boolean))];
    const nome = (soGeral ? 'Geral_' : '') + (resps.length === 1 ? resps[0].replace(/\s+/g, '_') + '_' : '') + hojeISO();
    return { buffer, nome: `Solicitacao_Reembolso_${nome}.xlsx`, itens };
}

async function exportarExcelFiltrado() {
    const x = await gerarExcel();
    if (!x) return avisoSelecionar();
    saveAs(new Blob([x.buffer], { type: XLSX_MIME }), x.nome);
}

/* =====================================================================
   MODAL DE RESULTADO
   ===================================================================== */
function mostrarResultado(tipo, titulo, texto, detalhe = '') {
    const [cor, icone] = { ok: ['emerald', 'fa-check'], erro: ['red', 'fa-xmark'], info: ['amber', 'fa-circle-info'] }[tipo];
    $('resIcone').className = `w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-2xl bg-${cor}-50 text-${cor}-600 ring-8 ring-${cor}-50/60`;
    $('resIcone').innerHTML = `<i class="fa-solid ${icone}"></i>`;
    $('resTitulo').innerText = titulo;
    $('resTexto').innerText = texto;
    $('resDetalhe').innerHTML = detalhe;
    $('modalResultado').classList.remove('hidden');
}

const cardsResumo = itens => `<div class="grid grid-cols-3 gap-2">${itens.map(([k, v]) =>
    `<div class="bg-slate-50 border border-slate-100 rounded-xl p-2"><div class="text-sm font-extrabold text-slate-800">${v}</div><div class="text-[9px] uppercase tracking-wider text-slate-400 font-bold">${k}</div></div>`).join('')}</div>`;

/* =====================================================================
   ENVIO POR E-MAIL
   ===================================================================== */
let emailCtx = null;
const listaEmails = s => String(s || '').split(/[,;\s]+/).map(e => e.trim()).filter(Boolean);
const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

function bufferParaB64(buf) {
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result.split(',')[1]);
        fr.onerror = rej;
        fr.readAsDataURL(new Blob([buf]));
    });
}

async function enviarPorEmail() {
    const x = await gerarExcel();
    if (!x) return avisoSelecionar();

    const arquivos = [...new Set(x.itens.flatMap(r => r.despesas.flatMap(d => d.arquivos)))];
    const total = x.itens.reduce((a, r) => a + totalRegistro(r), 0);
    const resp = [...new Set(x.itens.map(r => r.responsavel))].join(', ');
    emailCtx = { ...x, arquivos, total, resp };

    $('emailPara').value = Store.get('app_reembolso_email') || '';
    $('emailCc').value = Store.get('app_reembolso_cc') || '';
    $('emailErro').classList.add('hidden');
    $('emailPara').classList.remove('!border-red-400');
    $('emailResumo').innerHTML = [['Lançamentos', x.itens.length], ['Comprovantes', arquivos.length], ['Total', brl(total)]]
        .map(([k, v]) => `<div class="bg-white/15 rounded-xl p-2 text-center backdrop-blur"><div class="text-sm font-extrabold">${v}</div><div class="text-[9px] uppercase tracking-wider text-white/75 font-bold">${k}</div></div>`).join('');
    $('modalEmail').classList.remove('hidden');
    setTimeout(() => $('emailPara').focus(), 150);
}

function montarCorpoEmail(itens, msg) {
    const td = 'padding:6px 8px;border:1px solid #e2e8f0;font-size:12px';
    const linhas = [];
    itens.forEach(r => {
        const cli = r.modo === 'Geral' ? 'Geral' : r.cliente;
        if (custoBase(r) > 0) linhas.push([r.data, cli,
            r.modo === 'Particular' ? `Quilometragem (${Math.max(0, r.kmFinal - r.kmInicial)} km)` : `Aluguel (${r.kmFinal} diária(s))`, '', custoBase(r), []]);
        r.despesas.forEach(d => linhas.push([d.data, cli, d.categoria, infoEst(d), d.valor, d.arquivos]));
    });
    const total = itens.reduce((a, r) => a + totalRegistro(r), 0);
    const resp = [...new Set(itens.map(r => r.responsavel))].join(', ');
    const datas = itens.map(r => r.data).sort();
    const th = ['Data', 'Visita', 'Descrição', 'Estabelecimento / CNPJ', 'Valor', 'Comprovantes'].map(h => `<th style="${td};text-align:left">${h}</th>`).join('');
    return `<div style="font-family:Arial,sans-serif;color:#1e293b">
        ${msg ? `<p style="font-size:13px;margin:0 0 14px">${esc(msg).replace(/\n/g, '<br>')}</p>` : ''}
        <h2 style="margin:0 0 4px">Solicitação de Reembolso</h2>
        <p style="margin:0 0 12px;font-size:13px;color:#475569">
            <b>Responsável:</b> ${esc(resp)}<br><b>Período:</b> ${dataBR(datas[0])} a ${dataBR(datas[datas.length - 1])}<br><b>Lançamentos:</b> ${itens.length}
        </p>
        <table style="border-collapse:collapse;width:100%">
            <tr style="background:#0f172a;color:#fff">${th}</tr>
            ${linhas.map(l => `<tr>
                <td style="${td}">${dataBR(l[0])}</td><td style="${td}">${esc(l[1])}</td><td style="${td}">${esc(l[2])}</td><td style="${td}">${esc(l[3])}</td>
                <td style="${td};text-align:right">${brl(l[4])}</td>
                <td style="${td}">${l[5].length ? l[5].map((id, i) => `<a href="${urlArquivo(id)}">${i + 1}</a>`).join(' ') : '—'}</td></tr>`).join('')}
            <tr style="background:#0f172a;color:#fff;font-weight:bold">
                <td style="${td}" colspan="4">TOTAL</td><td style="${td};text-align:right">${brl(total)}</td><td style="${td}"></td>
            </tr>
        </table>
        <p style="font-size:11px;color:#94a3b8;margin-top:12px">Enviado pela Central de Reembolsos.</p>
    </div>`;
}

function corpoTexto(c, msg, excelId) {
    const L = [];
    if (msg) L.push(msg, '');
    L.push('SOLICITAÇÃO DE REEMBOLSO', `Responsável: ${c.resp}`, `Total: ${brl(c.total)}`, '');
    c.itens.forEach(r => {
        L.push(`• ${dataBR(r.data)} - ${r.modo === 'Geral' ? 'Geral' : r.cliente}: ${brl(totalRegistro(r))}`);
        r.despesas.forEach(d => L.push(`   - ${d.categoria} ${brl(d.valor)}${d.arquivos.length ? ' | ' + d.arquivos.map(urlArquivo).join(' ') : ''}`));
    });
    L.push('', `Planilha Excel: ${urlArquivo(excelId)}`);
    return L.join('\n');
}

function abrirGmail(para, cc, assunto, corpo, janela) {
    const q = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    if (!isMobile()) {
         const url = `https://mail.google.com/mail/u/${encodeURIComponent(sessao?.email || 0)}/?view=cm&fs=1&` + q({ to: para, cc, su: assunto, body: corpo });
        janela ? (janela.location.href = url) : window.open(url, '_blank');
        return;
    }
    const mailto = `mailto:${para}?` + q({ cc, subject: assunto, body: corpo });
    if (isIOS) {
        location.href = 'googlegmail://co?' + q({ to: para, cc, subject: assunto, body: corpo });
        setTimeout(() => { if (!document.hidden) location.href = mailto; }, 1500);
    } else {
        location.href = mailto;
    }
}

async function confirmarEnvioEmail(modo) {
    const para = listaEmails($('emailPara').value), cc = listaEmails($('emailCc').value);
    const invalido = !para.length || [...para, ...cc].some(e => !emailOk(e));
    $('emailErro').classList.toggle('hidden', !invalido);
    $('emailPara').classList.toggle('!border-red-400', invalido);
    if (invalido) return;
    Store.set('app_reembolso_email', para.join(', '));
    Store.set('app_reembolso_cc', cc.join(', '));

    const c = emailCtx, msg = $('emailMsg').value.trim();
    const ids = c.itens.map(r => r.id);
    const marcarLocal = () => {
        const em = new Date().toISOString();
        ids.forEach(id => { const r = reembolsos.find(x => x.id === id); if (r) { r.enviadoEm = em; r.enviadoPara = para.join(', '); } });
        renderizarTabela();
    };

    const assunto = `Solicitação de Reembolso - ${c.resp} - ${brl(c.total)}`;
    const janela = modo === 'gmail' && !isMobile() ? window.open('', '_blank') : null;

    const btns = document.querySelectorAll('#modalEmail button');
    const btn = $(modo === 'auto' ? 'btnEnviarAgora' : 'btnAbrirGmail'), orig = btn.innerHTML;
    btns.forEach(b => b.disabled = true);
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> ${modo === 'auto' ? 'Enviando...' : 'Preparando...'}`;
    try {
        const excelB64 = await bufferParaB64(c.buffer);
        if (modo === 'auto') {
            const r = await (await postSheets({
                action: 'email', para: para.join(','), cc: cc.join(','), assunto, ids,
                html: montarCorpoEmail(c.itens, msg), excel: { nome: c.nome, data: excelB64 }, arquivos: c.arquivos
            })).json();
            if (r.erro) throw new Error(r.erro);
            marcarLocal();
            fecharModal('modalEmail');
            mostrarResultado('ok', 'E-mail enviado!', `Para: ${para.join(', ')}`,
                cardsResumo([['Planilha', '1'], ['Anexos', r.anexos ?? '—'], ['Total', brl(c.total)]]) +
                (r.faltaram ? `<p class="text-[10px] text-amber-600 font-semibold mt-2">${r.faltaram} comprovante(s) foram só como link, por causa do limite de tamanho.</p>` : ''));
        } else {
            const up = await (await postSheets({ action: 'upload', mime: XLSX_MIME, nome: c.nome, data: excelB64 })).json();
            if (up.erro) throw new Error(up.erro);
            abrirGmail(para.join(','), cc.join(','), assunto, corpoTexto(c, msg, up.arquivoId), janela);
            postSheets({ action: 'marcarEnviado', ids, para: para.join(',') }).catch(() => {});
            marcarLocal();
            fecharModal('modalEmail');
            mostrarResultado('ok', 'Rascunho aberto no Gmail', 'Confira o e-mail e toque em Enviar no Gmail.',
                cardsResumo([['Lançamentos', c.itens.length], ['Links', c.arquivos.length + 1], ['Total', brl(c.total)]]));
        }
    } catch (e) {
        janela?.close();
        mostrarResultado('erro', 'Falha no envio', e.message || 'Verifique a conexão.');
    } finally {
        btns.forEach(b => b.disabled = false);
        btn.innerHTML = orig;
    }
}

/* =====================================================================
   PWA
   ===================================================================== */
let promptInstalacao = null;
const jaInstalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const mostrarBtnInstalar = () => { if (jaInstalado) return; $('btnInstalar').classList.remove('hidden'); $('btnInstalar').classList.add('flex'); };
const esconderBtnInstalar = () => { $('btnInstalar').classList.add('hidden'); $('btnInstalar').classList.remove('flex'); };

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); promptInstalacao = e; mostrarBtnInstalar(); });
window.addEventListener('appinstalled', esconderBtnInstalar);

async function instalarApp() {
    if (promptInstalacao) {
        promptInstalacao.prompt();
        await promptInstalacao.userChoice;
        promptInstalacao = null;
        esconderBtnInstalar();
        return;
    }
    mostrarResultado('info', 'Instalar aplicativo', isIOS
        ? 'No Safari, toque em Compartilhar (⬆️) e depois em "Adicionar à Tela de Início".'
        : 'No Chrome, toque no menu ⋮ e depois em "Instalar app" ou "Adicionar à tela inicial".');
}

/* =====================================================================
   LOGIN
   ===================================================================== */
function telaLogin(msg = '') {
    let el = $('telaLogin');
    if (!el) {
        el = document.createElement('div');
        el.id = 'telaLogin';
        el.className = 'fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur flex items-center justify-center p-4';
        el.innerHTML = `
        <form onsubmit="fazerLogin(event)" class="bg-white w-full max-w-xs rounded-2xl p-6 space-y-3 shadow-2xl text-center">
            <img src="${LOGO_URL}" class="h-10 mx-auto mb-2" alt="">
            <h2 class="font-extrabold text-slate-800">Central de Reembolsos</h2>
            <input id="loginEmail" type="email" required placeholder="Seu e-mail corporativo" autocomplete="username" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm">
            <input id="loginPin" type="password" inputmode="numeric" required placeholder="PIN" autocomplete="current-password" class="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-center tracking-[0.4em]">
            <p id="loginErro" class="text-[11px] text-red-500 font-semibold min-h-[1em]"></p>
            <button id="btnLogin" class="w-full bg-indigo-600 text-white rounded-xl py-2 font-bold text-sm">Entrar</button>
        </form>`;
        document.body.appendChild(el);
    }
    $('loginErro').innerText = msg;
    el.classList.remove('hidden');
}

async function fazerLogin(e) {
    e.preventDefault();
    const email = $('loginEmail').value.trim().toLowerCase(), pin = $('loginPin').value.trim();
    $('btnLogin').disabled = true;
    sessao = { email, pin };
    let r;
    try { r = await (await postSheets({ action: 'login' })).json(); } catch { r = { erro: 'Falha de conexão' }; }
    $('btnLogin').disabled = false;
    if (r.erro) { sessao = null; $('loginErro').innerText = r.erro; return; }
    sessao = { email, pin, ...r.usuario };
    Store.set('app_reembolso_sessao', JSON.stringify(sessao));
    $('telaLogin').classList.add('hidden');
    iniciarSessao();
}

function sair(msg = '') {
    sessao = null;
    Store.set('app_reembolso_sessao', '');
    reembolsos = [];
    renderizarTabela();
    telaLogin(msg);
}

function iniciarSessao() {
    const adm = !!sessao?.admin;
    Store.set('app_reembolso_usuario', sessao.nome);
    $('formResponsavel').readOnly = !adm;
    $('filtroResponsavel').classList.toggle('hidden', !adm);
    $('btnEnviarAgora')?.classList.add('hidden');
    carregarDadosDoSheets();
}


/* =====================================================================
   INICIALIZAÇÃO
   ===================================================================== */
montarBotoesFiltro();
sessao?.email ? iniciarSessao() : telaLogin();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW não registrado:', err));
}
if (isIOS || isAndroid) setTimeout(mostrarBtnInstalar, isIOS ? 0 : 3000);

