const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const bookshelf = document.getElementById('bookshelf');
const fileInput = document.getElementById('file-input');
const settingsModal = document.getElementById('settings-modal');

let currentBook = null;
let rendition = null;

// Configurações persistentes inspiradas no Play Livros
let readerSettings = JSON.parse(localStorage.getItem('reader_settings')) || {
    fontSize: 100,
    // Começa com a fonte nativa do Play Livros carregada via Google Fonts
    fontFamily: "'Literata', serif", 
    theme: 'sepia', // Começa no Sépia quente nativo
    brightness: 100
};

document.addEventListener('DOMContentLoaded', () => {
    loadLibrary();
    initUIEvents();
});

// --- BIBLIOTECA (IndexedDB via LocalForage) ---
async function loadLibrary() {
    bookshelf.innerHTML = '';
    const library = await localforage.getItem('library_metadata') || [];
    
    if (library.length === 0) {
        bookshelf.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #666; margin-top: 20px;">Nenhum livro salvo. Adicione um arquivo EPUB.</p>';
        return;
    }

    library.forEach(bookMeta => {
        const div = document.createElement('div');
        div.className = 'book-item';
        div.onclick = () => openBook(bookMeta.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '✕'; // Ícone ✕ para excluir
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (confirm(`Excluir permanentemente o livro "${bookMeta.title}" do leitor?`)) {
                await localforage.removeItem(bookMeta.id);
                const novaBiblioteca = library.filter(b => b.id !== bookMeta.id);
                await localforage.setItem('library_metadata', novaBiblioteca);
                loadLibrary();
            }
        };

        const img = document.createElement('img');
        img.className = 'book-cover';
        img.src = bookMeta.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="%23ddd"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle">Sem Capa</text></svg>';
        
        const title = document.createElement('div');
        title.className = 'book-title';
        title.textContent = bookMeta.title;

        div.appendChild(deleteBtn);
        div.appendChild(img);
        div.appendChild(title);
        bookshelf.appendChild(div);
    });
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    document.querySelector('.upload-btn').childNodes[0].textContent = "Processando...";
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bookData = ePub(arrayBuffer);
        await bookData.ready;
        const metadata = await bookData.loaded.metadata;
        let coverBase64 = null;
        try {
            const coverUrl = await bookData.coverUrl();
            if (coverUrl) {
                const response = await fetch(coverUrl);
                const blob = await response.blob();
                coverBase64 = await new Promise(res => {
                    const reader = new FileReader();
                    reader.onloadend = () => res(reader.result);
                    reader.readAsDataURL(blob);
                });
            }
        } catch(e) {}
        const bookId = 'book_' + Date.now();
        await localforage.setItem(bookId, arrayBuffer);
        const library = await localforage.getItem('library_metadata') || [];
        library.push({ id: bookId, title: metadata.title, cover: coverBase64, cfi: null });
        await localforage.setItem('library_metadata', library);
        await loadLibrary();
    } catch (error) { alert("Erro ao processar o arquivo."); } 
    finally {
        document.querySelector('.upload-btn').childNodes[0].textContent = "Adicionar EPUB";
        fileInput.value = '';
    }
});

// --- RENDERIZAÇÃO DO LIVRO ---
async function openBook(bookId) {
    libraryView.style.display = 'none';
    readerView.style.display = 'block';
    readerView.classList.add('ui-hidden');
    settingsModal.classList.add('hidden');

    try {
        const arrayBuffer = await localforage.getItem(bookId);
        currentBook = ePub(arrayBuffer);
        
        rendition = currentBook.renderTo('viewer', {
            width: '100%',
            height: '100%',
            spread: 'none',
            manager: 'continuous',
            flow: 'paginated'
        });

        // Configuração dos Temas Nativos (Hexadecimais exatos do Play Livros)
        rendition.themes.register("light", { "body": { "background": "#ffffff !important", "color": "#000000 !important" }});
        // Sépia ajustado: fundo mais creme (#f4ecd8) e fonte marrom nativa forte (#26180f)
        rendition.themes.register("sepia", { "body": { "background": "#f4ecd8 !important", "color": "#26180f !important" }});
        rendition.themes.register("dark", { "body": { "background": "#121212 !important", "color": "#e0e0e0 !important" }});
        
        rendition.themes.select(readerSettings.theme);
        rendition.themes.fontSize(readerSettings.fontSize + "%");
        
        // Aplica a Literata como fonte nativa
        if(readerSettings.fontFamily !== 'Original') rendition.themes.font(readerSettings.fontFamily);

        // CORREÇÃO CRÍTICA: Injeção de Estilos Dinâmicos (Notch + PRIMEIRA FRASE FORTE)
        rendition.hooks.content.register((contents) => {
            const style = contents.document.createElement('style');
            style.id = 'epub-dynamic-styles';
            // Injeção de padding de área segura e regra nativa para NEGRITO na PRIMEIRA LINHA
            style.innerHTML = `
                body {
                    padding: calc(20px + env(safe-area-inset-top)) 20px calc(40px + env(safe-area-inset-bottom)) 20px !important; 
                    margin: 0 !important; 
                    background-color: transparent !important;
                }
                
                /* Efeito Nativo do Play Livros: Negrito na primeira linha do primeiro parágrafo */
                /* Caça o primeiro parágrafo verdadeiro que não tenha imagem */
                body > p:first-of-type::first-line,
                body > div > p:first-of-type::first-line,
                section > p:first-of-type::first-line,
                div[role="main"] > p:first-of-type::first-line {
                    font-weight: 700 !important;
                }
            `;
            contents.document.head.appendChild(style);
        });

        aplicarConfiguracoesDinamicas();

        const library = await localforage.getItem('library_metadata');
        const bookMeta = library.find(b => b.id === bookId);
        
        if (bookMeta && bookMeta.cfi) {
            try { await rendition.display(bookMeta.cfi); } catch(e) { await rendition.display(); }
        } else {
            await rendition.display();
        }

        currentBook.ready.then(() => {
            return currentBook.locations.generate(1600);
        }).then(() => {
            if(rendition.location) {
                const percentage = currentBook.locations.percentageFromCfi(rendition.location.start.cfi);
                const percentRounded = Math.round(percentage * 100);
                document.getElementById('progress-slider').value = percentRounded;
                document.getElementById('page-info').textContent = `${percentRounded}%`;
            }
        });

        rendition.on('relocated', async (location) => {
            bookMeta.cfi = location.start.cfi;
            await localforage.setItem('library_metadata', library);
            
            if(currentBook.locations.length > 0) {
                const percentage = currentBook.locations.percentageFromCfi(location.start.cfi);
                const percentRounded = Math.round(percentage * 100);
                document.getElementById('progress-slider').value = percentRounded;
                document.getElementById('page-info').textContent = `${percentRounded}%`;
            }
        });

    } catch (e) { fecharLivro(); }
}

function fecharLivro() {
    if (currentBook) { currentBook.destroy(); currentBook = null; rendition = null; }
    document.getElementById('viewer').innerHTML = '';
    readerView.style.display = 'none';
    libraryView.style.display = 'block';
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', '#ffffff');
}

// --- INTERAÇÕES DA UI (Zonas de toque, Modal, Abas) ---
function initUIEvents() {
    document.getElementById('zone-left').addEventListener('click', () => { if (rendition) rendition.prev(); fecharMenus(); });
    document.getElementById('zone-right').addEventListener('click', () => { if (rendition) rendition.next(); fecharMenus(); });
    
    document.getElementById('zone-center').addEventListener('click', () => {
        const isHidden = readerView.classList.contains('ui-hidden');
        if (isHidden) { readerView.classList.remove('ui-hidden'); } 
        else { fecharMenus(); }
    });

    document.getElementById('btn-back').addEventListener('click', fecharLivro);
    document.getElementById('btn-aa').addEventListener('click', () => settingsModal.classList.toggle('hidden'));

    function fecharMenus() {
        readerView.classList.add('ui-hidden');
        settingsModal.classList.add('hidden');
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(`tab-${e.target.dataset.tab}`).classList.add('active');
        });
    });

    // Alteração de Tipografia
    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const fontBtn = e.currentTarget;
            readerSettings.fontFamily = fontBtn.dataset.font;
            aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig();
        });
    });

    document.getElementById('btn-font-plus').addEventListener('click', () => { readerSettings.fontSize += 10; aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig(); });
    document.getElementById('btn-font-minus').addEventListener('click', () => { if(readerSettings.fontSize > 50) readerSettings.fontSize -= 10; aplicarConfiguracoesDinamicas(); atualizarUI(); salvarConfig(); });

    // Alternador de Temas e Brilho (CORREÇÃO DE CAMUFLAGEM DO RELÓGIO)
    document.querySelectorAll('.theme-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            readerSettings.theme = e.target.dataset.theme;
            aplicarConfiguracoesDinamicas();
            salvarConfig();
        });
    });

    document.getElementById('brightness-slider').addEventListener('input', (e) => { readerSettings.brightness = e.target.value; aplicarBrilho(); salvarConfig(); });

    atualizarUI(); 
}

// --- ROTINAS REATIVAS (Aplicações em tempo de execução) ---
function salvarConfig() { localStorage.setItem('reader_settings', JSON.stringify(readerSettings)); }

// Função simplificada e robusta para atualizar a UI e o theme-color do navegador
function aplicarConfiguracoesDinamicas() {
    if (!rendition) return;
    
    rendition.themes.select(readerSettings.theme);
    
    // CORREÇÃO CRÍTICA: Camuflagem Inteligente do Relógio do iPhone (Novos Hexadecimais)
    const bgColors = { 'light': '#ffffff', 'sepia': '#f4ecd8', 'dark': '#121212' };
    const currentBgColor = bgColors[readerSettings.theme];
    
    // Atualiza o fundo do leitor e o modal
    readerView.style.background = currentBgColor;
    settingsModal.style.background = (readerSettings.theme === 'dark') ? '#1f1f1f' : '#ffffff';
    
    // MAGIA AQUI: Atualiza a meta tag theme-color do iPhone dinamicamente!
    const themeColorMeta = document.getElementById('theme-color-meta');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', currentBgColor);
    }

    rendition.themes.fontSize(readerSettings.fontSize + "%");
    if(readerSettings.fontFamily !== 'Original') {
        rendition.themes.font(readerSettings.fontFamily);
    } else {
        rendition.themes.font(''); // Reseta para a fonte do livro
    }

    aplicarBrilho();
}

function aplicarBrilho() {
    const overlay = document.getElementById('brightness-overlay');
    const darkness = 1 - (readerSettings.brightness / 100);
    overlay.style.opacity = darkness;
}

function atualizarUI() {
    document.getElementById('font-size-display').textContent = readerSettings.fontSize + '%';
    document.getElementById('brightness-slider').value = readerSettings.brightness;
    aplicarBrilho();
    
    // Sincroniza botões de fonte
    document.querySelectorAll('.font-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.font === readerSettings.fontFamily);
    });
    
    // Sincroniza botões de tema
    document.querySelectorAll('.theme-color-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.theme === readerSettings.theme);
    });
}
