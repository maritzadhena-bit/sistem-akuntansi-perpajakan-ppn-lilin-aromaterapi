const SUPABASE_URL = 'https://ytwqjjzuqcsrsqzssnpw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CvfCPBmGuupMvyScXIzvhw_y8jBkccW';

const SB_HEADERS = {
	apikey: SUPABASE_KEY,
	Authorization: `Bearer ${SUPABASE_KEY}`,
	'Content-Type': 'application/json',
	Prefer: 'return=representation'
};

function sbUrl(path) {
	return `${SUPABASE_URL}/rest/v1/${path}`;
}

async function sbGet(table, query = '') {
	const url = query ? sbUrl(`${table}?${query}`) : sbUrl(table);
	const res = await fetch(url, { headers: SB_HEADERS });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

async function sbPost(table, body) {
	const res = await fetch(sbUrl(table), {
		method: 'POST',
		headers: SB_HEADERS,
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

async function sbPatch(table, id, body) {
	const res = await fetch(sbUrl(`${table}?id=eq.${id}`), {
		method: 'PATCH',
		headers: SB_HEADERS,
		body: JSON.stringify(body)
	});
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

async function sbDelete(table, id) {
	const res = await fetch(sbUrl(`${table}?id=eq.${id}`), {
		method: 'DELETE',
		headers: SB_HEADERS
	});
	if (!res.ok) throw new Error(await res.text());
}

const TAX_RATE = 0.11;
const AVATAR_GRADIENTS = [
	'linear-gradient(135deg,#f97316,#ec4899)',
	'linear-gradient(135deg,#a855f7,#6366f1)',
	'linear-gradient(135deg,#10b981,#14b8a6)',
	'linear-gradient(135deg,#ec4899,#f43f5e)',
	'linear-gradient(135deg,#f59e0b,#f97316)'
];

let productsCache = [];
let suppliersCache = [];
let currentPage = 'dashboard';
let previousAromaSelection = '';

const PAGE_META = {
	dashboard: { title: 'Selamat Datang 👋', subtitle: 'Ringkasan bisnis lilin Anda', eyebrow: 'AROMA LEDGER / OVERVIEW' },
	produk: { title: 'Produk', subtitle: 'Kelola katalog dan persediaan produk', eyebrow: 'AROMA LEDGER / KATALOG' },
	supplier: { title: 'Supplier', subtitle: 'Kelola data mitra usaha Anda', eyebrow: 'AROMA LEDGER / MITRA' },
	pembelian: { title: 'Pembelian', subtitle: 'Catat barang masuk dan PPN masukan', eyebrow: 'AROMA LEDGER / TRANSAKSI' },
	penjualan: { title: 'Penjualan', subtitle: 'Catat barang keluar dan PPN keluaran', eyebrow: 'AROMA LEDGER / TRANSAKSI' },
	jurnal: { title: 'Jurnal Umum', subtitle: 'Rincian jurnal dari transaksi periode ini', eyebrow: 'AROMA LEDGER / BUKU BESAR' },
	ppn: { title: 'Laporan PPN', subtitle: 'Rekap PPN masukan dan keluaran', eyebrow: 'AROMA LEDGER / PAJAK' },
	'laba-rugi': { title: 'Laba Rugi', subtitle: 'Ringkasan kinerja usaha per periode', eyebrow: 'AROMA LEDGER / KINERJA' }
};

async function apiRequest(endpoint, options = {}) {
	const normalized = endpoint.replace(/^\/+/, '');
	const [table, id] = normalized.split('/');
	const method = (options.method || 'GET').toUpperCase();

	if (method === 'GET') {
		return sbGet(table, options.query || '');
	}
	if (method === 'POST') {
		return sbPost(table, options.body ? JSON.parse(options.body) : {});
	}
	if (method === 'PUT' || method === 'PATCH') {
		return sbPatch(table, id, options.body ? JSON.parse(options.body) : {});
	}
	if (method === 'DELETE') {
		return sbDelete(table, id);
	}
	throw new Error(`Method ${method} tidak didukung.`);
}

// Helper tampilan: avatar, teks aman, format angka/tanggal, dan bulan berjalan.
function getAvatarColor(nama = '') {
	let hash = 0;
	for (const character of String(nama)) {
		hash = (hash * 31 + character.charCodeAt(0)) | 0;
	}
	return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function getInitials(nama = '') {
	const words = String(nama).trim().split(/\s+/).filter(Boolean);
	if (words.length > 1) {
		return words.slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
	}
	return Array.from(words[0] || '').slice(0, 2).join('').toUpperCase() || '?';
}

function formatRupiah(angka = 0) {
	const value = Number(angka);
	return `Rp ${Number.isFinite(value) ? Math.round(value).toLocaleString('id-ID') : '0'}`;
}

function formatTanggal(iso = '') {
	if (!iso) return '-';
	const datePart = String(iso).slice(0, 10);
	const date = new Date(`${datePart}T00:00:00`);
	if (Number.isNaN(date.getTime())) return '-';
	return new Intl.DateTimeFormat('id-ID', {
		day: '2-digit',
		month: 'short',
		year: 'numeric'
	}).format(date);
}

function getBulanIni() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(value = '') {
	return String(value).replace(/[&<>"']/g, (character) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	})[character]);
}

function renderEmptyState(pesan, colspan = 1) {
	const safeColspan = Math.max(1, Number.parseInt(colspan, 10) || 1);
	return `<tr class="empty-row"><td colspan="${safeColspan}"><span aria-hidden="true" style="display:block;font-size:30px;margin-bottom:8px;opacity:.65">🕯️</span>${escapeHtml(pesan)}</td></tr>`;
}

function showToast(pesan, tipe = 'info') {
	let container = document.getElementById('toast-stack');
	if (!container) {
		container = document.createElement('div');
		container.id = 'toast-stack';
		Object.assign(container.style, {
			position: 'fixed',
			top: '18px',
			right: '18px',
			zIndex: '1000',
			display: 'grid',
			gap: '10px',
			width: 'min(360px, calc(100vw - 36px))'
		});
		container.setAttribute('aria-live', 'polite');
		container.setAttribute('aria-atomic', 'false');
		document.body.append(container);
	}

	const gradients = {
		success: 'linear-gradient(135deg,#059669,#14b8a6)',
		error: 'linear-gradient(135deg,#ef4444,#ec4899)',
		danger: 'linear-gradient(135deg,#ef4444,#dc2626)',
		warning: 'linear-gradient(135deg,#f97316,#f59e0b)',
		info: 'linear-gradient(135deg,#7c3aed,#ec4899)'
	};
	const icons = { success: '✓', error: '!', danger: '!', warning: '!', info: '✦' };
	const toast = document.createElement('div');
	Object.assign(toast.style, {
		display: 'flex',
		alignItems: 'center',
		gap: '11px',
		padding: '13px 16px',
		border: '1px solid rgba(255,255,255,.45)',
		borderRadius: '14px',
		background: gradients[tipe] || gradients.info,
		boxShadow: '0 12px 30px rgba(30,27,75,.22)',
		color: '#fff',
		font: '600 13px Inter, sans-serif',
		animation: 'toast-enter .22s ease both'
	});

	const icon = document.createElement('span');
	icon.textContent = icons[tipe] || icons.info;
	Object.assign(icon.style, {
		display: 'grid',
		width: '25px',
		height: '25px',
		flex: '0 0 25px',
		placeItems: 'center',
		borderRadius: '50%',
		background: 'rgba(255,255,255,.2)',
		fontWeight: '800'
	});
	const message = document.createElement('span');
	message.textContent = pesan;
	toast.append(icon, message);
	container.append(toast);
	window.setTimeout(() => {
		toast.style.opacity = '0';
		toast.style.transform = 'translateY(-6px)';
		toast.style.transition = 'opacity .2s ease, transform .2s ease';
		window.setTimeout(() => toast.remove(), 220);
	}, 3000);
}

function showDuplicateModal(pesan) {
	const previousFocus = document.activeElement;
	const previousOverflow = document.body.style.overflow;
	const overlay = document.createElement('div');
	overlay.className = 'modal-duplicate-overlay';

	const modal = document.createElement('section');
	modal.className = 'modal-duplicate';
	modal.setAttribute('role', 'alertdialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-labelledby', 'duplicate-modal-title');
	modal.setAttribute('aria-describedby', 'duplicate-modal-message');

	const icon = document.createElement('span');
	icon.className = 'icon-warning';
	icon.setAttribute('aria-hidden', 'true');
	icon.textContent = '⚠️';

	const title = document.createElement('h3');
	title.id = 'duplicate-modal-title';
	title.textContent = 'Produk Sudah Terdaftar';

	const message = document.createElement('p');
	message.className = 'pesan';
	message.id = 'duplicate-modal-message';
	message.textContent = pesan;

	const closeButton = document.createElement('button');
	closeButton.type = 'button';
	closeButton.textContent = 'Mengerti';

	modal.append(icon, title, message, closeButton);
	overlay.append(modal);
	document.body.append(overlay);
	document.body.style.overflow = 'hidden';

	function closeModal() {
		document.removeEventListener('keydown', handleKeydown);
		overlay.remove();
		document.body.style.overflow = previousOverflow;
		if (previousFocus instanceof HTMLElement) previousFocus.focus();
	}

	function handleKeydown(event) {
		if (event.key === 'Escape') closeModal();
	}

	closeButton.addEventListener('click', closeModal);
	overlay.addEventListener('click', (event) => {
		if (event.target === overlay) closeModal();
	});
	document.addEventListener('keydown', handleKeydown);
	closeButton.focus();
}

// Navigasi antarhalaman dan pemanggilan loader untuk halaman yang dipilih.
async function showPage(pageId) {
	const page = PAGE_META[pageId] ? pageId : 'dashboard';
	currentPage = page;
	document.querySelectorAll('.page-section').forEach((section) => {
		const isCurrent = section.id === `page-${page}`;
		section.hidden = !isCurrent;
		section.classList.toggle('is-active', isCurrent);
	});
	document.querySelectorAll('.nav-link[data-page]').forEach((link) => {
		const isCurrent = link.dataset.page === page;
		link.classList.toggle('is-active', isCurrent);
		if (isCurrent) link.setAttribute('aria-current', 'page');
		else link.removeAttribute('aria-current');
	});

	const meta = PAGE_META[page];
	document.getElementById('page-title').textContent = meta.title;
	document.getElementById('page-subtitle').textContent = meta.subtitle;
	document.getElementById('page-eyebrow').textContent = meta.eyebrow;

	const loaders = {
		dashboard: loadDashboard,
		produk: async () => Promise.all([loadProducts(), loadAromaDropdown()]),
		supplier: loadSuppliers,
		pembelian: async () => Promise.all([loadPurchases(), loadSupplierDropdown(), loadProductDropdown()]),
		penjualan: async () => Promise.all([loadSales(), loadProductDropdown()]),
		jurnal: loadJournals,
		ppn: loadPpnReport,
		'laba-rugi': loadLabaRugi
	};

	try {
		await loaders[page]();
	} catch (error) {
		showToast(error.message, 'error');
	}
}

// Produk: daftar, formulir tambah/edit, dan penghapusan.
async function loadProducts() {
	productsCache = await sbGet('products', 'order=created_at.desc');
	const tbody = document.getElementById('products-tbody');
	document.getElementById('products-count').textContent = `${productsCache.length} produk`;
	if (!productsCache.length) {
		tbody.innerHTML = renderEmptyState('Belum ada produk. Tambahkan produk pertama Anda.', 7);
		return productsCache;
	}

	tbody.innerHTML = productsCache.map((product) => `
		<tr>
			<td><div class="product-cell"><span class="avatar" style="background:${getAvatarColor(product.nama)}">${getInitials(product.nama)}</span><strong>${escapeHtml(product.nama)}</strong></div></td>
			<td><span class="source-badge source-badge--${product.sumber === 'essential' ? 'essential' : 'signature'}">${product.sumber === 'essential' ? 'Essential' : 'Signature'}</span></td>
			<td><span class="status-badge status-badge--info">${escapeHtml(product.aroma || 'Tanpa aroma')}</span></td>
			<td>${formatRupiah(product.harga_pokok)}</td>
			<td>${formatRupiah(product.harga_jual)}</td>
			<td>${Number(product.stok || 0).toLocaleString('id-ID')}</td>
			<td><div class="table-actions"><button class="button button--quiet button--small" type="button" data-action="add-stock" data-id="${escapeHtml(product.id)}">+ Stok</button><button class="button button--quiet button--small" type="button" data-action="edit-product" data-id="${escapeHtml(product.id)}">Edit</button><button class="button button--danger button--small" type="button" data-action="delete-product" data-id="${escapeHtml(product.id)}">Hapus</button></div></td>
		</tr>`).join('');
	return productsCache;
}

async function loadAromaDropdown() {
	const select = document.getElementById('product-aroma');
	if (!select) return [];
	const selected = select.value;
	const rows = await sbGet('products', 'select=aroma&aroma=not.is.null&order=aroma.asc');
	const aromas = [...new Map(rows
		.map((row) => String(row.aroma || '').trim())
		.filter(Boolean)
		.map((aroma) => [aroma.toLocaleLowerCase(), aroma]))
		.values()]
		.sort((left, right) => left.localeCompare(right, 'id'));
	select.replaceChildren(new Option('Pilih aroma', ''));
	for (const aroma of aromas) {
		select.add(new Option(aroma, aroma));
	}
	select.add(new Option('+ Tambah Aroma Baru...', '__new__'));
	if (aromas.includes(selected)) select.value = selected;
	else if (selected && selected !== '__new__') select.value = selected;
	previousAromaSelection = select.value;
	return aromas;
}

function updateProductNamePreview() {
	const source = document.getElementById('product-sumber').value;
	const aroma = document.getElementById('product-aroma').value;
	const prefix = source === 'signature' ? 'Signature' : 'Essential';
	document.querySelector('#product-name-preview strong').textContent = aroma && aroma !== '__new__'
		? `${prefix} ${aroma}`
		: 'Pilih sumber dan aroma';
}

function openAddAromaModal() {
	const form = document.getElementById('add-aroma-form');
	form.reset();
	document.getElementById('add-aroma-modal').showModal();
	document.getElementById('new-aroma-name').focus();
}

function saveNewAroma(event) {
	event.preventDefault();
	const select = document.getElementById('product-aroma');
	const aroma = document.getElementById('new-aroma-name').value.trim();
	if (!aroma) return;
	const existing = [...select.options].find((option) => option.value.toLocaleLowerCase() === aroma.toLocaleLowerCase());
	if (existing) {
		select.value = existing.value;
	} else {
		select.add(new Option(aroma, aroma), select.lastElementChild);
		select.value = aroma;
	}
	previousAromaSelection = select.value;
	document.getElementById('add-aroma-modal').close();
	updateProductNamePreview();
}

async function submitProduct(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const productId = document.getElementById('product-id').value;
	const data = Object.fromEntries(new FormData(form));
	delete data.id;
	if (productId) {
		delete data.sumber;
		delete data.aroma;
	} else {
		data.aroma = document.getElementById('product-aroma').value;
	}
	data.harga_pokok = Number(document.getElementById('product-harga-pokok').value);
	data.harga_jual = Number(document.getElementById('product-harga-jual').value);
	data.stok = Number(document.getElementById('product-stok').value);

	try {
		if (productId) {
			await sbPatch('products', productId, data);
		} else {
			await sbPost('products', data);
		}
		showToast(productId ? 'Produk berhasil diperbarui.' : 'Produk berhasil ditambahkan.', 'success');
		resetProductForm();
		await Promise.all([loadProducts(), loadProductDropdown(), loadAromaDropdown()]);
	} catch (error) {
		const message = typeof error?.message === 'string' ? error.message : 'Error';
		if (message.startsWith('Produk ini sudah terdaftar di inventaris.')) {
			showDuplicateModal(message);
		} else {
			showToast(message, 'error');
		}
	}
}

function editProduct(id) {
	const product = productsCache.find((item) => item.id === id);
	if (!product) return showToast('Produk tidak ditemukan.', 'error');
	document.getElementById('product-id').value = product.id;
	document.getElementById('product-aroma').value = product.aroma || '';
	document.getElementById('product-sumber').value = product.sumber || 'signature';
	document.getElementById('product-aroma').disabled = true;
	document.getElementById('product-sumber').disabled = true;
	document.getElementById('product-harga-pokok').value = product.harga_pokok ?? 0;
	document.getElementById('product-harga-jual').value = product.harga_jual ?? 0;
	document.getElementById('product-stok').value = product.stok ?? 0;
	document.getElementById('product-form-title').textContent = 'Edit produk';
	document.getElementById('product-submit').textContent = 'Simpan perubahan';
	updateProductNamePreview();
	document.getElementById('product-harga-pokok').focus();
}

async function deleteProduct(id) {
	const product = productsCache.find((item) => item.id === id);
	if (!window.confirm(`Hapus produk "${product?.nama || 'ini'}"?`)) return;
	try {
		await sbDelete('products', id);
		showToast('Produk berhasil dihapus.', 'success');
		await Promise.all([loadProducts(), loadProductDropdown(), loadAromaDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

function resetProductForm() {
	const form = document.getElementById('product-form');
	form.reset();
	document.getElementById('product-id').value = '';
	document.getElementById('product-sumber').value = 'signature';
	previousAromaSelection = '';
	document.getElementById('product-sumber').disabled = false;
	document.getElementById('product-aroma').disabled = false;
	document.getElementById('product-aroma').value = '';
	document.getElementById('product-form-title').textContent = 'Tambah produk';
	document.getElementById('product-submit').textContent = 'Simpan produk';
	updateProductNamePreview();
}

async function openAddStockModal(productId) {
	let product;
	try {
		const products = await sbGet('products', `id=eq.${productId}`);
		product = products[0];
	} catch (error) {
		return showToast(error.message, 'error');
	}
	const cachedIndex = productsCache.findIndex((item) => item.id === productId);
	if (cachedIndex >= 0) productsCache[cachedIndex] = product;
	else productsCache.push(product);

	const form = document.getElementById('add-stock-form');
	form.reset();
	document.getElementById('stock-new-price-field').hidden = true;
	document.getElementById('stock-new-sale-price').disabled = true;
	document.getElementById('stock-new-sale-price').required = false;
	document.getElementById('add-stock-product-id').value = product.id;
	document.getElementById('add-stock-title').textContent = `Tambah Stok — ${product.nama}`;
	document.getElementById('stock-current-qty').textContent = `${Number(product.stok || 0).toLocaleString('id-ID')} unit`;
	document.getElementById('stock-current-hpp').textContent = formatRupiah(product.harga_pokok);
	document.getElementById('stock-current-price').textContent = formatRupiah(product.harga_jual);
	updateAddStockPreview();
	document.getElementById('add-stock-modal').showModal();
	document.getElementById('add-stock-qty').focus();
}

function updateAddStockPreview() {
	const productId = document.getElementById('add-stock-product-id').value;
	const product = productsCache.find((item) => item.id === productId);
	if (!product) return;
	const addedQuantity = Math.max(0, Number(document.getElementById('add-stock-qty').value) || 0);
	const unitCost = Math.max(0, Number(document.getElementById('add-stock-cost').value) || 0);
	const oldStock = Number(product.stok || 0);
	const oldHpp = Number(product.harga_pokok || 0);
	const newStock = oldStock + addedQuantity;
	const newHpp = newStock > 0
		? (oldStock * oldHpp + addedQuantity * unitCost) / newStock
		: oldHpp;
	document.getElementById('stock-next-qty').textContent = `${newStock.toLocaleString('id-ID')} unit`;
	document.getElementById('stock-next-hpp').textContent = formatRupiah(newHpp);
}

async function submitAddStock(event) {
	event.preventDefault();
	const productId = document.getElementById('add-stock-product-id').value;
	const product = productsCache.find((item) => item.id === productId);
	if (!product) return showToast('Produk tidak ditemukan.', 'error');

	const quantity = Number(document.getElementById('add-stock-qty').value);
	const unitCost = Number(document.getElementById('add-stock-cost').value);
	const updateSellingPrice = document.querySelector('input[name="stock-price-mode"]:checked').value === 'update';
	const newSellingPrice = Number(document.getElementById('stock-new-sale-price').value);

	if (!Number.isFinite(quantity) || quantity <= 0) {
		return showToast('Jumlah stok yang ditambahkan harus lebih dari 0.', 'error');
	}

	try {
		const existingProducts = await sbGet('products', `id=eq.${productId}`);
		const existing = existingProducts[0];
		const oldStock = Number(existing.stok || 0);
		const oldHpp = Number(existing.harga_pokok || 0);
		const newStock = oldStock + quantity;
		const newHpp = newStock > 0 ? (oldStock * oldHpp + quantity * unitCost) / newStock : oldHpp;
		const payload = {
			stok: newStock,
			harga_pokok: newHpp
		};
		if (updateSellingPrice && Number.isFinite(newSellingPrice)) payload.harga_jual = newSellingPrice;
		await sbPatch('products', productId, payload);
		document.getElementById('add-stock-modal').close();
		showToast(`Stok ${product.nama} +${quantity} unit, HPP baru ${formatRupiah(newHpp)}`, 'success');
		await Promise.all([loadProducts(), loadProductDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

// Supplier: daftar dengan avatar inisial dan operasi tambah/edit/hapus.
async function loadSuppliers() {
	suppliersCache = await sbGet('suppliers', 'order=created_at.desc');
	const tbody = document.getElementById('suppliers-tbody');
	document.getElementById('suppliers-count').textContent = `${suppliersCache.length} supplier`;
	if (!suppliersCache.length) {
		tbody.innerHTML = renderEmptyState('Belum ada supplier. Tambahkan mitra usaha Anda.', 4);
		return suppliersCache;
	}

	tbody.innerHTML = suppliersCache.map((supplier) => `
		<tr>
			<td><div class="supplier-cell"><span class="avatar" style="background:${getAvatarColor(supplier.nama)}">${getInitials(supplier.nama)}</span><strong>${escapeHtml(supplier.nama)}</strong></div></td>
			<td>${escapeHtml(supplier.npwp || '-')}</td>
			<td>${escapeHtml(supplier.alamat || '-')}</td>
			<td><div class="table-actions"><button class="button button--quiet button--small" type="button" data-action="edit-supplier" data-id="${escapeHtml(supplier.id)}">Edit</button><button class="button button--danger button--small" type="button" data-action="delete-supplier" data-id="${escapeHtml(supplier.id)}">Hapus</button></div></td>
		</tr>`).join('');
	return suppliersCache;
}

async function submitSupplier(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const supplierId = document.getElementById('supplier-id').value;
	const data = Object.fromEntries(new FormData(form));
	delete data.id;
	try {
		if (supplierId) {
			await sbPatch('suppliers', supplierId, data);
		} else {
			await sbPost('suppliers', data);
		}
		showToast(supplierId ? 'Supplier berhasil diperbarui.' : 'Supplier berhasil ditambahkan.', 'success');
		resetSupplierForm();
		await Promise.all([loadSuppliers(), loadSupplierDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

function editSupplier(id) {
	const supplier = suppliersCache.find((item) => item.id === id);
	if (!supplier) return showToast('Supplier tidak ditemukan.', 'error');
	document.getElementById('supplier-id').value = supplier.id;
	document.getElementById('supplier-nama').value = supplier.nama || '';
	document.getElementById('supplier-npwp').value = supplier.npwp || '';
	document.getElementById('supplier-alamat').value = supplier.alamat || '';
	document.getElementById('supplier-form-title').textContent = 'Edit supplier';
	document.getElementById('supplier-submit').textContent = 'Simpan perubahan';
	document.getElementById('supplier-nama').focus();
}

async function deleteSupplier(id) {
	const supplier = suppliersCache.find((item) => item.id === id);
	if (!window.confirm(`Hapus supplier "${supplier?.nama || 'ini'}"?`)) return;
	try {
		await sbDelete('suppliers', id);
		showToast('Supplier berhasil dihapus.', 'success');
		await Promise.all([loadSuppliers(), loadSupplierDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

function resetSupplierForm() {
	const form = document.getElementById('supplier-form');
	form.reset();
	document.getElementById('supplier-id').value = '';
	document.getElementById('supplier-form-title').textContent = 'Tambah supplier';
	document.getElementById('supplier-submit').textContent = 'Simpan supplier';
}

// Mengisi dropdown transaksi dari data master terbaru.
async function loadSupplierDropdown() {
	suppliersCache = await sbGet('suppliers', 'order=created_at.desc');
	const select = document.getElementById('purchase-supplier');
	const selected = select.value;
	select.replaceChildren(new Option('Pilih supplier', ''));
	for (const supplier of suppliersCache) {
		select.add(new Option(supplier.nama, supplier.id));
	}
	if (suppliersCache.some((supplier) => supplier.id === selected)) select.value = selected;
	return suppliersCache;
}

async function loadProductDropdown() {
	productsCache = await sbGet('products', 'order=created_at.desc');
	for (const [id, placeholder] of [['purchase-product', 'Tanpa produk terkait'], ['sale-product', 'Pilih produk']]) {
		const select = document.getElementById(id);
		const selected = select.value;
		const emptyLabel = id === 'purchase-product' ? 'Pilih produk' : placeholder;
		select.replaceChildren(new Option(emptyLabel, ''));
		const eligibleProducts = productsCache;
		for (const product of eligibleProducts) {
			const stockText = id === 'sale-product' ? ` · stok ${product.stok}` : '';
			const signatureMarker = id === 'sale-product' && product.sumber === 'signature' ? '✨ ' : '';
			select.add(new Option(`${signatureMarker}${product.nama}${stockText}`, product.id));
		}
		if (eligibleProducts.some((product) => product.id === selected)) select.value = selected;
	}
	updatePurchaseCategory();
	updateSaleProductInfo();
	updateSalePreview();
	return productsCache;
}

function updatePurchaseCategory() {
	const isFinishedProduct = document.getElementById('purchase-kategori').value === 'bahan_jadi';
	const productFields = document.getElementById('purchase-product-fields');
	const productSelect = document.getElementById('purchase-product');
	const quantityInput = document.getElementById('purchase-qty');
	productFields.hidden = !isFinishedProduct;
	productSelect.required = isFinishedProduct;
	quantityInput.required = isFinishedProduct;
	if (!isFinishedProduct) {
		productSelect.value = '';
		quantityInput.value = '';
	} else if (!quantityInput.value) {
		quantityInput.value = '1';
	}
}

// Pembelian: daftar, preview pajak, penyimpanan, dan penghapusan transaksi.
async function loadPurchases() {
	const [purchases, suppliers, products] = await Promise.all([
		sbGet('purchases', 'order=tanggal.desc,created_at.desc'),
		sbGet('suppliers', 'order=created_at.desc'),
		sbGet('products', 'order=created_at.desc')
	]);
	suppliersCache = suppliers;
	productsCache = products;
	const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
	const productById = new Map(products.map((product) => [product.id, product]));
	const tbody = document.getElementById('purchases-tbody');
	if (!purchases.length) {
		tbody.innerHTML = renderEmptyState('Belum ada transaksi pembelian.', 9);
		return purchases;
	}

	tbody.innerHTML = purchases.map((purchase) => {
		const supplier = supplierById.get(purchase.supplier_id);
		const product = productById.get(purchase.product_id);
		const category = {
			bahan_baku: { label: 'Bahan Baku', className: 'badge-kategori-bahan-baku' },
			bahan_jadi: { label: 'Bahan Jadi', className: 'badge-kategori-bahan-jadi' },
			lainnya: { label: 'Lainnya', className: 'badge-kategori-lainnya' }
		}[purchase.kategori] || { label: 'Bahan Baku', className: 'badge-kategori-bahan-baku' };
		const description = purchase.keterangan || 'Pembelian';
		const quantity = purchase.kategori === 'bahan_jadi'
			? Number(purchase.qty || 0).toLocaleString('id-ID')
			: '-';
		return `<tr>
			<td>${formatTanggal(purchase.tanggal)}</td>
			<td><span class="status-badge status-badge--info">${escapeHtml(supplier?.nama || 'Supplier dihapus')}</span></td>
			<td><span class="${category.className}">${category.label}</span></td>
			<td>${escapeHtml(product?.nama || '-')}</td>
			<td>${quantity}</td>
			<td>${formatRupiah(purchase.dpp)}</td>
			<td>${formatRupiah(purchase.ppn_masukan)}</td>
			<td><strong>${formatRupiah(purchase.total)}</strong><small class="table-detail">${escapeHtml(description)}</small></td>
			<td><button class="button button--danger button--small" type="button" data-action="delete-purchase" data-id="${escapeHtml(purchase.id)}">Hapus</button></td>
		</tr>`;
	}).join('');
	return purchases;
}

function updatePurchasePreview() {
	const dpp = Math.max(0, Number(document.getElementById('purchase-dpp').value) || 0);
	const ppn = Math.round((dpp * TAX_RATE + Number.EPSILON) * 100) / 100;
	document.getElementById('purchase-preview-ppn').textContent = formatRupiah(ppn);
	document.getElementById('purchase-preview-total').textContent = formatRupiah(dpp + ppn);
}

async function submitPurchase(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const data = Object.fromEntries(new FormData(form));
	const kategori = data.kategori || 'bahan_baku';
	const supplierId = data.supplier_id || null;
	const selectedProduct = productsCache.find((product) => product.id === data.product_id);
	let productId = null;
	let qty = 0;

	if (kategori === 'bahan_jadi') {
		productId = data.product_id || null;
		qty = Number(data.qty);
		if (!productId) throw new Error("Kategori 'Bahan Jadi' wajib memilih produk.");
		if (!Number.isInteger(qty) || qty <= 0) throw new Error("Kategori 'Bahan Jadi' wajib mengisi qty.");
	} else {
		productId = null;
		qty = 0;
	}

	const dpp = Number(data.dpp);
	if (!data.tanggal || !Number.isFinite(dpp) || dpp < 0) {
		throw new Error('Tanggal dan DPP wajib valid.');
	}
	const ppnMasukan = Math.round((dpp * TAX_RATE + Number.EPSILON) * 100) / 100;
	const purchase = {
		supplier_id: supplierId,
		product_id: productId,
		kategori,
		tanggal: data.tanggal,
		keterangan: data.keterangan || null,
		qty,
		dpp,
		ppn_masukan: ppnMasukan,
		total: dpp + ppnMasukan
	};

	try {
		const created = await sbPost('purchases', purchase);
		let result = created?.[0] || created || purchase;
		if (kategori === 'bahan_jadi' && productId) {
			const productList = await sbGet('products', `id=eq.${productId}`);
			const product = productList[0];
			if (!product) throw new Error('Produk tidak ditemukan.');
			const hppBaru = ((Number(product.stok || 0) * Number(product.harga_pokok || 0)) + dpp) / (Number(product.stok || 0) + qty);
			await sbPatch('products', productId, {
				stok: Number(product.stok || 0) + qty,
				harga_pokok: hppBaru
			});
			result = { ...result, stok_updated: true, hpp_baru: hppBaru };
			showToast(`Pembelian berhasil. Stok ${selectedProduct?.nama || 'produk'} +${qty} unit. HPP terupdate jadi ${formatRupiah(hppBaru)}.`, 'success');
		} else {
			result = { ...result, stok_updated: false, ppn_masukan: ppnMasukan };
			showToast(`Pembelian berhasil dicatat. PPN Masukan ${formatRupiah(ppnMasukan)}.`, 'success');
		}
		form.reset();
		setToday('purchase-tanggal');
		updatePurchaseCategory();
		updatePurchasePreview();
		await Promise.all([loadPurchases(), loadProductDropdown()]);
		return result;
	} catch (error) {
		showToast(error.message, 'error');
		throw error;
	}
}

async function deletePurchase(id) {
	if (!window.confirm('Hapus transaksi pembelian ini? Stok terkait akan disesuaikan.')) return;
	try {
		const rows = await sbGet('purchases', `id=eq.${id}`);
		const purchase = rows[0];
		if (purchase?.kategori === 'bahan_jadi' && purchase.product_id) {
			const productRows = await sbGet('products', `id=eq.${purchase.product_id}`);
			const product = productRows[0];
			if (product) {
				await sbPatch('products', purchase.product_id, {
					stok: Math.max(0, Number(product.stok || 0) - Number(purchase.qty || 0))
				});
			}
		}
		await sbDelete('purchases', id);
		showToast('Pembelian berhasil dihapus.', 'success');
		await Promise.all([loadPurchases(), loadProductDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

// Penjualan: chip produk dan hitungan preview mengikuti produk serta jumlah terpilih.
function getSelectedSaleProduct() {
	const productId = document.getElementById('sale-product').value;
	return productsCache.find((product) => product.id === productId) || null;
}

function updateSaleProductInfo() {
	const product = getSelectedSaleProduct();
	const info = document.getElementById('sale-product-info');
	info.hidden = !product;
	if (!product) return;
	document.getElementById('sale-info-harga-jual').textContent = formatRupiah(product.harga_jual);
	document.getElementById('sale-info-harga-pokok').textContent = formatRupiah(product.harga_pokok);
	document.getElementById('sale-info-stok').textContent = Number(product.stok || 0).toLocaleString('id-ID');
}

function updateSalePreview() {
	const product = getSelectedSaleProduct();
	const qty = Math.max(0, Number(document.getElementById('sale-qty').value) || 0);
	const dpp = product ? qty * Number(product.harga_jual || 0) : 0;
	const ppn = Math.round((dpp * TAX_RATE + Number.EPSILON) * 100) / 100;
	const hpp = product ? qty * Number(product.harga_pokok || 0) : 0;
	document.getElementById('sale-preview-dpp').textContent = formatRupiah(dpp);
	document.getElementById('sale-preview-ppn').textContent = formatRupiah(ppn);
	document.getElementById('sale-preview-hpp').textContent = formatRupiah(hpp);
	document.getElementById('sale-preview-total').textContent = formatRupiah(dpp + ppn);
}

async function loadSales() {
	const [sales, products] = await Promise.all([
		sbGet('sales', 'order=tanggal.desc,created_at.desc'),
		sbGet('products', 'order=created_at.desc')
	]);
	productsCache = products;
	const productById = new Map(products.map((product) => [product.id, product]));
	const tbody = document.getElementById('sales-tbody');
	if (!sales.length) {
		tbody.innerHTML = renderEmptyState('Belum ada transaksi penjualan.', 9);
		return sales;
	}

	tbody.innerHTML = sales.map((sale) => `
		<tr>
			<td>${formatTanggal(sale.tanggal)}</td>
			<td>${escapeHtml(sale.customer || '-')}</td>
			<td>${escapeHtml(productById.get(sale.product_id)?.nama || 'Produk dihapus')}</td>
			<td>${Number(sale.qty).toLocaleString('id-ID')}</td>
			<td>${formatRupiah(sale.dpp)}</td>
			<td>${formatRupiah(sale.ppn_keluaran)}</td>
			<td>${formatRupiah(sale.hpp)}</td>
			<td><strong>${formatRupiah(sale.total)}</strong></td>
			<td><button class="button button--danger button--small" type="button" data-action="delete-sale" data-id="${escapeHtml(sale.id)}">Hapus</button></td>
		</tr>`).join('');
	return sales;
}

async function submitSale(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const data = Object.fromEntries(new FormData(form));
	const productId = data.product_id;
	const qty = Number(data.qty);
	if (!productId) throw new Error('Pilih produk terlebih dahulu.');
	if (!Number.isInteger(qty) || qty <= 0) throw new Error('Jumlah penjualan harus lebih dari 0.');

	try {
		const productRows = await sbGet('products', `id=eq.${productId}`);
		const product = productRows[0];
		if (!product) throw new Error('Produk tidak ditemukan.');
		if (qty > Number(product.stok || 0)) throw new Error('Stok tidak cukup.');

		const hargaSatuan = Number(product.harga_jual || 0);
		const dpp = Math.round((qty * hargaSatuan + Number.EPSILON) * 100) / 100;
		const ppnKeluaran = Math.round((dpp * TAX_RATE + Number.EPSILON) * 100) / 100;
		const hpp = Math.round((qty * Number(product.harga_pokok || 0) + Number.EPSILON) * 100) / 100;
		const sale = {
			product_id: productId,
			tanggal: data.tanggal,
			customer: data.customer || null,
			qty,
			harga_satuan: hargaSatuan,
			dpp,
			ppn_keluaran: ppnKeluaran,
			hpp,
			total: dpp + ppnKeluaran
		};

		await sbPost('sales', sale);
		await sbPatch('products', productId, { stok: Number(product.stok || 0) - qty });
		showToast('Penjualan berhasil dicatat.', 'success');
		form.reset();
		setToday('sale-tanggal');
		updateSaleProductInfo();
		updateSalePreview();
		await Promise.all([loadSales(), loadProductDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

async function deleteSale(id) {
	if (!window.confirm('Hapus transaksi penjualan ini? Stok terkait akan dikembalikan.')) return;
	try {
		const rows = await sbGet('sales', `id=eq.${id}`);
		const sale = rows[0];
		if (sale?.product_id) {
			const productRows = await sbGet('products', `id=eq.${sale.product_id}`);
			const product = productRows[0];
			if (product) {
				await sbPatch('products', sale.product_id, {
					stok: Number(product.stok || 0) + Number(sale.qty || 0)
				});
			}
		}
		await sbDelete('sales', id);
		showToast('Penjualan berhasil dihapus.', 'success');
		await Promise.all([loadSales(), loadProductDropdown()]);
	} catch (error) {
		showToast(error.message, 'error');
	}
}

// Laporan periode: jurnal, PPN, laba rugi, dan ringkasan dashboard.
function selectedMonth(id) {
	const input = document.getElementById(id);
	if (!input.value) input.value = getBulanIni();
	return input.value;
}

async function loadJournals() {
	const month = selectedMonth('journal-month');
	const [tahun, bln] = month.split('-').map(Number);
	const awal = `${month}-01`;
	const akhir = `${new Date(tahun, bln, 1).getFullYear()}-${String(new Date(tahun, bln, 1).getMonth() + 1).padStart(2, '0')}-01`;
	const sales = await sbGet('sales', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`);
	const purchases = await sbGet('purchases', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`);
	const rows = [];

	sales.forEach((sale) => {
		const ref = `SALE-${String(sale.id).slice(0, 8)}`;
		rows.push(
			{ tanggal: sale.tanggal, ref, akun: '101 Kas', debit: Number(sale.total || 0), kredit: 0, keterangan: `Jual ke ${sale.customer || 'konsumen'}` },
			{ tanggal: sale.tanggal, ref, akun: '401 Penjualan', debit: 0, kredit: Number(sale.dpp || 0), keterangan: '' },
			{ tanggal: sale.tanggal, ref, akun: '211 PPN Keluaran', debit: 0, kredit: Number(sale.ppn_keluaran || 0), keterangan: 'PPN 11%' },
			{ tanggal: sale.tanggal, ref, akun: '501 HPP', debit: Number(sale.hpp || 0), kredit: 0, keterangan: 'HPP perpetual' },
			{ tanggal: sale.tanggal, ref, akun: '102 Persediaan Barang Jadi', debit: 0, kredit: Number(sale.hpp || 0), keterangan: '' }
		);
	});

	purchases.forEach((purchase) => {
		const ref = `PUR-${String(purchase.id).slice(0, 8)}`;
		let akunDebit = '599 Biaya Lain-lain';
		switch (purchase.kategori) {
			case 'bahan_baku': akunDebit = '104 Persediaan Bahan Baku'; break;
			case 'bahan_jadi': akunDebit = '102 Persediaan Barang Jadi'; break;
			default: akunDebit = '599 Biaya Lain-lain';
		}
		rows.push(
			{ tanggal: purchase.tanggal, ref, akun: akunDebit, debit: Number(purchase.dpp || 0), kredit: 0, keterangan: purchase.keterangan || 'Pembelian' },
			{ tanggal: purchase.tanggal, ref, akun: '111 PPN Masukan', debit: Number(purchase.ppn_masukan || 0), kredit: 0, keterangan: 'PPN 11%' },
			{ tanggal: purchase.tanggal, ref, akun: '101 Kas', debit: 0, kredit: Number(purchase.total || 0), keterangan: 'Bayar supplier' }
		);
	});

	rows.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
	const tbody = document.getElementById('journals-tbody');
	const table = tbody.closest('table');
	table.classList.add('journal-table');
	const headers = table.querySelectorAll('thead th');
	headers[3]?.classList.add('col-debit');
	headers[4]?.classList.add('col-kredit');
	headers[5]?.classList.add('col-keterangan');
	const footerCells = table.querySelectorAll('tfoot td');
	footerCells[0]?.classList.add('col-debit');
	footerCells[1]?.classList.add('col-kredit');
	document.getElementById('journals-count').textContent = `${rows.length} baris`;
	if (!rows.length) {
		tbody.innerHTML = renderEmptyState('Tidak ada jurnal pada periode ini.', 6);
	} else {
		let previousRef = null;
		let groupIndex = -1;
		tbody.innerHTML = rows.map((row, index) => {
			const ref = String(row.ref || `ROW-${index}`);
			const isGroupStart = index === 0 || ref !== previousRef;
			if (isGroupStart) groupIndex += 1;
			const nextRef = index < rows.length - 1 ? String(rows[index + 1].ref || `ROW-${index + 1}`) : null;
			const isGroupEnd = index === rows.length - 1 || ref !== nextRef;
			const groupClass = groupIndex % 2 === 0 ? 'journal-group-a' : 'journal-group-b';
			const rowClasses = [groupClass, isGroupStart ? 'journal-group-start' : '', isGroupEnd ? 'journal-group-end' : ''].filter(Boolean).join(' ');
			const refType = /^SALE(?:-|$)/i.test(ref) ? 'sale' : 'pur';
			const refCell = isGroupStart ? `<span class="badge-ref-${refType}">${escapeHtml(ref)}</span>` : '';
			previousRef = ref;
			return `
				<tr class="${rowClasses}">
					<td>${formatTanggal(row.tanggal)}</td>
					<td>${refCell}</td>
					<td>${escapeHtml(row.akun || '-')}</td>
					<td class="numeric-cell col-debit">${Number(row.debit) ? formatRupiah(row.debit) : '—'}</td>
					<td class="numeric-cell col-kredit">${Number(row.kredit) ? formatRupiah(row.kredit) : '—'}</td>
					<td class="col-keterangan">${escapeHtml(row.keterangan || '-')}</td>
				</tr>`;
		}).join('');
	}

	const totalDebit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
	const totalKredit = rows.reduce((sum, row) => sum + Number(row.kredit || 0), 0);
	document.getElementById('journal-total-debit').textContent = formatRupiah(totalDebit);
	document.getElementById('journal-total-kredit').textContent = formatRupiah(totalKredit);
	const badge = document.getElementById('journal-balance');
	const isBalanced = Math.abs(totalDebit - totalKredit) < 0.01;
	badge.textContent = isBalanced ? 'BALANCE ✓' : 'SELISIH!';
	badge.style.background = isBalanced ? '#d1fae5' : '#fee2e2';
	badge.style.color = isBalanced ? '#065f46' : '#991b1b';
}

async function loadPpnReport() {
	const month = selectedMonth('ppn-month');
	const [tahun, bln] = month.split('-').map(Number);
	const awal = `${month}-01`;
	const akhir = `${new Date(tahun, bln, 1).getFullYear()}-${String(new Date(tahun, bln, 1).getMonth() + 1).padStart(2, '0')}-01`;
	const sales = await sbGet('sales', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`);
	const purchases = await sbGet('purchases', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`);
	const dpp_jual = sales.reduce((sum, sale) => sum + Number(sale.dpp || 0), 0);
	const ppn_keluaran = sales.reduce((sum, sale) => sum + Number(sale.ppn_keluaran || 0), 0);
	const dpp_beli = purchases.reduce((sum, purchase) => sum + Number(purchase.dpp || 0), 0);
	const ppn_masukan = purchases.reduce((sum, purchase) => sum + Number(purchase.ppn_masukan || 0), 0);
	const selisih = ppn_keluaran - ppn_masukan;
	let status = 'Nihil';
	if (selisih > 0) status = 'Kurang Bayar';
	else if (selisih < 0) status = 'Lebih Bayar';

	document.getElementById('ppn-dpp-jual').textContent = formatRupiah(dpp_jual);
	document.getElementById('ppn-keluaran').textContent = formatRupiah(ppn_keluaran);
	document.getElementById('ppn-dpp-beli').textContent = formatRupiah(dpp_beli);
	document.getElementById('ppn-masukan').textContent = formatRupiah(ppn_masukan);
	document.getElementById('ppn-selisih').textContent = formatRupiah(selisih);
	setPpnStatus(document.getElementById('ppn-status'), status);
	return { dpp_jual, ppn_keluaran, dpp_beli, ppn_masukan, selisih, status };
}

function setPpnStatus(element, status) {
	const label = status || 'Nihil';
	const modifiers = {
		'Lebih Bayar': 'lebih-bayar',
		'Kurang Bayar': 'kurang-bayar',
		Nihil: 'nihil'
	};
	element.className = `ppn-status ${modifiers[label] || 'nihil'}`;
	element.textContent = label;
}

async function loadLabaRugi() {
	const month = selectedMonth('profit-month');
	const [tahun, bln] = month.split('-').map(Number);
	const awal = `${month}-01`;
	const akhir = `${new Date(tahun, bln, 1).getFullYear()}-${String(new Date(tahun, bln, 1).getMonth() + 1).padStart(2, '0')}-01`;
	const sales = await sbGet('sales', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`);
	const purchases = await sbGet('purchases', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`);
	const penjualan = sales.reduce((sum, sale) => sum + Number(sale.dpp || 0), 0);
	const hpp = sales.reduce((sum, sale) => sum + Number(sale.hpp || 0), 0);
	const laba_kotor = penjualan - hpp;
	const biaya_lain = purchases
		.filter((purchase) => purchase.kategori === 'lainnya')
		.reduce((sum, purchase) => sum + Number(purchase.dpp || 0), 0);
	const laba_bersih = laba_kotor - biaya_lain;

	document.getElementById('lr-penjualan').textContent = formatRupiah(penjualan);
	document.getElementById('lr-hpp').textContent = formatRupiah(-hpp);
	document.getElementById('lr-laba-kotor').textContent = formatRupiah(laba_kotor);
	document.getElementById('lr-biaya-lain').textContent = formatRupiah(-biaya_lain);
	document.getElementById('lr-laba-bersih').textContent = formatRupiah(laba_bersih);
	return { penjualan, hpp, laba_kotor, biaya_lain, laba_bersih };
}

function cetakLaporan(halaman) {
	const filterIds = {
		ppn: 'ppn-month',
		jurnal: 'journal-month',
		labarugi: 'profit-month'
	};
	const tanggal = new Date().toLocaleString('id-ID', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
	const dateElement = document.getElementById(`print-date-${halaman}`);
	const filterElement = document.getElementById(filterIds[halaman]);
	const periodElement = document.getElementById(`print-period-${halaman}`);

	if (dateElement) dateElement.textContent = tanggal;
	if (filterElement?.value && periodElement) {
		const [year, month] = filterElement.value.split('-').map(Number);
		const formattedMonth = new Date(year, month - 1).toLocaleString('id-ID', {
			month: 'long',
			year: 'numeric'
		});
		periodElement.textContent = `Periode: ${formattedMonth}`;
	}

	window.print();
}

function animateCurrency(element, targetValue) {
	const target = Number(targetValue) || 0;
	const start = Number(element.dataset.currentValue) || 0;
	const duration = 700;
	const startTime = performance.now();
	if (element.animationFrame) cancelAnimationFrame(element.animationFrame);

	if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		element.textContent = formatRupiah(target);
		element.dataset.currentValue = String(target);
		return;
	}

	function frame(now) {
		const progress = Math.min((now - startTime) / duration, 1);
		const eased = 1 - (1 - progress) ** 3;
		const value = start + (target - start) * eased;
		element.textContent = formatRupiah(value);
		if (progress < 1) {
			element.animationFrame = requestAnimationFrame(frame);
		} else {
			element.dataset.currentValue = String(target);
			element.animationFrame = null;
		}
	}
	element.animationFrame = requestAnimationFrame(frame);
}

async function loadDashboard() {
	const month = selectedMonth('dashboard-month');
	const [tahun, bln] = month.split('-').map(Number);
	const awal = `${month}-01`;
	const akhir = `${new Date(tahun, bln, 1).getFullYear()}-${String(new Date(tahun, bln, 1).getMonth() + 1).padStart(2, '0')}-01`;
	const [sales, purchases] = await Promise.all([
		sbGet('sales', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`),
		sbGet('purchases', `tanggal=gte.${awal}&tanggal=lt.${akhir}&order=tanggal.asc`)
	]);
	const ppn = {
		dpp_jual: sales.reduce((sum, sale) => sum + Number(sale.dpp || 0), 0),
		ppn_keluaran: sales.reduce((sum, sale) => sum + Number(sale.ppn_keluaran || 0), 0),
		dpp_beli: purchases.reduce((sum, purchase) => sum + Number(purchase.dpp || 0), 0),
		ppn_masukan: purchases.reduce((sum, purchase) => sum + Number(purchase.ppn_masukan || 0), 0),
		selisih: sales.reduce((sum, sale) => sum + Number(sale.ppn_keluaran || 0), 0) - purchases.reduce((sum, purchase) => sum + Number(purchase.ppn_masukan || 0), 0)
	};
	ppn.status = ppn.selisih > 0 ? 'Kurang Bayar' : ppn.selisih < 0 ? 'Lebih Bayar' : 'Nihil';
	const profit = {
		penjualan: sales.reduce((sum, sale) => sum + Number(sale.dpp || 0), 0),
		hpp: sales.reduce((sum, sale) => sum + Number(sale.hpp || 0), 0),
		biaya_lain: purchases.filter((purchase) => purchase.kategori === 'lainnya').reduce((sum, purchase) => sum + Number(purchase.dpp || 0), 0),
		laba_kotor: sales.reduce((sum, sale) => sum + Number(sale.dpp || 0), 0) - sales.reduce((sum, sale) => sum + Number(sale.hpp || 0), 0),
		laba_bersih: (sales.reduce((sum, sale) => sum + Number(sale.dpp || 0), 0) - sales.reduce((sum, sale) => sum + Number(sale.hpp || 0), 0)) - purchases.filter((purchase) => purchase.kategori === 'lainnya').reduce((sum, purchase) => sum + Number(purchase.dpp || 0), 0)
	};
	animateCurrency(document.getElementById('dashboard-total-penjualan'), profit.penjualan);
	animateCurrency(document.getElementById('dashboard-total-pembelian'), ppn.dpp_beli);
	animateCurrency(document.getElementById('dashboard-ppn-keluaran'), ppn.ppn_keluaran);
	animateCurrency(document.getElementById('dashboard-ppn-masukan'), ppn.ppn_masukan);

	const status = document.getElementById('dashboard-status');
	const balance = document.getElementById('dashboard-selisih');
	setPpnStatus(status, ppn.status);
	const difference = Number(ppn.selisih) || 0;
	balance.textContent = `${difference < 0 ? '−' : ''}${formatRupiah(Math.abs(difference))}`;
	return { ppn, profit };
}

// Mengatur nilai tanggal lokal agar form tidak bergeser karena zona waktu.
function setToday(id) {
	const now = new Date();
	const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	document.getElementById(id).value = localDate;
}

// Inisialisasi event listener setelah seluruh elemen HTML tersedia.
function initializeApp() {
	document.querySelectorAll('[data-page]').forEach((link) => {
		link.addEventListener('click', (event) => {
			if (link.tagName === 'A') event.preventDefault();
			showPage(link.dataset.page);
		});
	});

	document.getElementById('product-form').addEventListener('submit', submitProduct);
	document.getElementById('supplier-form').addEventListener('submit', submitSupplier);
	document.getElementById('purchase-form').addEventListener('submit', submitPurchase);
	document.getElementById('sale-form').addEventListener('submit', submitSale);
	document.getElementById('product-reset').addEventListener('click', resetProductForm);
	document.getElementById('supplier-reset').addEventListener('click', resetSupplierForm);
	document.getElementById('product-sumber').addEventListener('change', updateProductNamePreview);
	document.getElementById('product-aroma').addEventListener('change', (event) => {
		if (event.currentTarget.value === '__new__') {
			event.currentTarget.value = previousAromaSelection;
			openAddAromaModal();
			return;
		}
		previousAromaSelection = event.currentTarget.value;
		updateProductNamePreview();
	});
	document.getElementById('add-aroma-form').addEventListener('submit', saveNewAroma);
	document.getElementById('add-aroma-close').addEventListener('click', () => document.getElementById('add-aroma-modal').close());
	document.getElementById('add-aroma-cancel').addEventListener('click', () => document.getElementById('add-aroma-modal').close());
	document.getElementById('product-add-button').addEventListener('click', () => {
		resetProductForm();
		document.getElementById('product-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
		document.getElementById('product-sumber').focus({ preventScroll: true });
	});
	document.getElementById('purchase-kategori').addEventListener('change', updatePurchaseCategory);
	document.getElementById('purchase-dpp').addEventListener('input', updatePurchasePreview);
	document.getElementById('add-stock-form').addEventListener('submit', submitAddStock);
	document.getElementById('add-stock-qty').addEventListener('input', updateAddStockPreview);
	document.getElementById('add-stock-cost').addEventListener('input', updateAddStockPreview);
	document.getElementById('add-stock-close').addEventListener('click', () => document.getElementById('add-stock-modal').close());
	document.getElementById('add-stock-cancel').addEventListener('click', () => document.getElementById('add-stock-modal').close());
	document.querySelectorAll('input[name="stock-price-mode"]').forEach((radio) => {
		radio.addEventListener('change', () => {
			const updatePrice = radio.checked && radio.value === 'update';
			const field = document.getElementById('stock-new-price-field');
			const input = document.getElementById('stock-new-sale-price');
			if (!radio.checked) return;
			field.hidden = !updatePrice;
			input.disabled = !updatePrice;
			input.required = updatePrice;
		});
	});
	document.getElementById('sale-product').addEventListener('change', () => {
		updateSaleProductInfo();
		updateSalePreview();
	});
	document.getElementById('sale-qty').addEventListener('input', updateSalePreview);

	const actionHandlers = {
		'add-stock': openAddStockModal,
		'edit-product': editProduct,
		'delete-product': deleteProduct,
		'edit-supplier': editSupplier,
		'delete-supplier': deleteSupplier,
		'delete-purchase': deletePurchase,
		'delete-sale': deleteSale
	};
	for (const tbodyId of ['products-tbody', 'suppliers-tbody', 'purchases-tbody', 'sales-tbody']) {
		document.getElementById(tbodyId).addEventListener('click', (event) => {
			const button = event.target.closest('[data-action]');
			if (!button) return;
			const handler = actionHandlers[button.dataset.action];
			if (handler) handler(button.dataset.id);
		});
	}

	const monthInputs = [...document.querySelectorAll('[data-month-filter]')];
	monthInputs.forEach((input) => {
		input.value = getBulanIni();
		input.addEventListener('change', () => {
			monthInputs.forEach((otherInput) => {
				if (otherInput !== input) otherInput.value = input.value;
			});
			const loaders = {
				dashboard: loadDashboard,
				jurnal: loadJournals,
				ppn: loadPpnReport,
				'laba-rugi': loadLabaRugi
			};
			if (loaders[currentPage]) {
				loaders[currentPage]().catch((error) => showToast(error.message, 'error'));
			}
		});
	});

	setToday('purchase-tanggal');
	setToday('sale-tanggal');
	updatePurchasePreview();
	updateSalePreview();
	showPage('dashboard');
}

document.addEventListener('DOMContentLoaded', initializeApp);
