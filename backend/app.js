// Dependensi bawaan Node.js saja. Node.js 18+ menyediakan global fetch.
const http = require('http');
const fs = require('fs');
const path = require('path');

// Konfigurasi Supabase dan server.
const SUPABASE_URL = 'https://ytwqjjzuqcsrsqzssnpw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CvfCPBmGuupMvyScXIzvhw_y8jBkccW';
const PORT = 3001;
const TAX_RATE = 0.11;
const FRONTEND_DIR = path.resolve(__dirname, '../frontend');
const DUPLICATE_PRODUCT_MESSAGE = `Produk ini sudah terdaftar di inventaris.

• Mau TAMBAH STOK produk ini?
	Tutup form ini, lalu klik tombol '+ Tambah Stok' pada
	baris produk di tabel Inventaris di bawah.

• Mau VARIAN BARU?
	Ubah pilihan Jenis atau Aroma menjadi kombinasi yang
	belum pernah didaftarkan.`;

// Membuat error API yang menyimpan status HTTP untuk diteruskan ke klien.
function apiError(message, status = 500) {
	const error = new Error(message);
	error.status = status;
	return error;
}

// Semua panggilan Supabase REST menggunakan API key dan bearer token yang sama.
async function supabaseRequest(resource, method, body) {
	const headers = {
		apikey: SUPABASE_KEY,
		Authorization: `Bearer ${SUPABASE_KEY}`,
		Accept: 'application/json'
	};

	if (body !== undefined) {
		headers['Content-Type'] = 'application/json';
		headers.Prefer = 'return=representation';
	}

	const response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const responseText = await response.text();
	let responseData = null;

	if (responseText) {
		try {
			responseData = JSON.parse(responseText);
		} catch (error) {
			responseData = responseText;
		}
	}

	if (!response.ok) {
		const message = responseData && typeof responseData === 'object'
			? responseData.message || responseData.details || response.statusText
			: responseData || response.statusText;
		throw apiError(`Supabase: ${message}`, response.status);
	}

	return responseData;
}

// Helper spesifik metode HTTP untuk tabel Supabase REST.
function supabaseGet(resource) {
	return supabaseRequest(resource, 'GET');
}

function supabasePost(table, data) {
	return supabaseRequest(table, 'POST', data);
}

function supabasePatch(resource, data) {
	return supabaseRequest(resource, 'PATCH', data);
}

function supabaseDelete(resource) {
	return supabaseRequest(resource, 'DELETE');
}

// Membungkus hasil API sebagai JSON dengan header CORS.
function sendJson(response, statusCode, data) {
	response.writeHead(statusCode, {
		'Content-Type': 'application/json; charset=utf-8',
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type'
	});
	response.end(JSON.stringify(data));
}

// Membaca body JSON dengan batas ukuran dan pesan error yang jelas.
function readJsonBody(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		const maxBodySize = 1024 * 1024;

		request.on('data', (chunk) => {
			body += chunk;
			if (Buffer.byteLength(body) > maxBodySize) {
				reject(apiError('Ukuran request terlalu besar.', 413));
				request.destroy();
			}
		});

		request.on('end', () => {
			if (!body) {
				resolve({});
				return;
			}

			try {
				const parsedBody = JSON.parse(body);
				if (!parsedBody || Array.isArray(parsedBody) || typeof parsedBody !== 'object') {
					reject(apiError('Body harus berupa object JSON.', 400));
					return;
				}
				resolve(parsedBody);
			} catch (error) {
				reject(apiError('Format JSON tidak valid.', 400));
			}
		});

		request.on('error', reject);
	});
}

// Mengubah nilai numeric dari Postgres REST menjadi angka JavaScript.
function numeric(value, fieldName) {
	const result = Number(value);
	if (!Number.isFinite(result)) {
		throw apiError(`${fieldName} harus berupa angka yang valid.`, 400);
	}
	return result;
}

function roundMoney(value) {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Memvalidasi parameter bulan dan menghasilkan batas tanggal [awal, awal bulan berikutnya).
function monthDateRange(month) {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) {
		throw apiError('Parameter bulan wajib menggunakan format YYYY-MM.', 400);
	}

	const [year, monthNumber] = month.split('-').map(Number);
	const start = `${month}-01`;
	const nextMonth = new Date(Date.UTC(year, monthNumber, 1));
	const end = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-01`;
	return { start, end };
}

// Mengambil transaksi pada bulan yang diminta.
async function getMonthlyRows(table, month) {
	const { start, end } = monthDateRange(month);
	const resource = `${table}?select=*&tanggal=gte.${start}&tanggal=lt.${end}&order=tanggal.asc,created_at.asc`;
	return supabaseGet(resource);
}

function sumField(rows, field) {
	return roundMoney(rows.reduce((total, row) => total + Number(row[field] || 0), 0));
}

// Memperbarui stok memakai filter stok lama agar perubahan bersamaan tidak saling menimpa.
async function adjustProductStock(productId, change) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const products = await supabaseGet(`products?select=id,stok&id=eq.${encodeURIComponent(productId)}`);
		const product = products[0];

		if (!product) {
			throw apiError('Produk tidak ditemukan.', 404);
		}

		const currentStock = Number(product.stok);
		const nextStock = currentStock + change;
		if (!Number.isInteger(nextStock) || nextStock < 0) {
			throw apiError('Stok produk tidak mencukupi.', 409);
		}

		const updatedProducts = await supabasePatch(
			`products?id=eq.${encodeURIComponent(productId)}&stok=eq.${encodeURIComponent(currentStock)}`,
			{ stok: nextStock }
		);

		if (updatedProducts && updatedProducts.length > 0) {
			return nextStock;
		}
	}

	throw apiError('Stok berubah bersamaan. Silakan ulangi transaksi.', 409);
}

// Menambah persediaan dan menghitung ulang HPP dengan weighted average.
async function addProductStockWeightedAverage(productId, quantity, unitCost, options = {}) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const products = await supabaseGet(
			`products?select=id,sumber,stok,harga_pokok,harga_jual&id=eq.${encodeURIComponent(productId)}`
		);
		const product = products[0];
		if (!product) {
			throw apiError('Produk tidak ditemukan.', 404);
		}
		if (options.requiredSource && product.sumber !== options.requiredSource) {
			throw apiError(`Stok hanya dapat ditambahkan untuk produk ${options.requiredSource}.`, 409);
		}

		const oldStock = numeric(product.stok, 'stok');
		const oldHpp = numeric(product.harga_pokok, 'harga_pokok');
		const newStock = oldStock + quantity;
		const newHpp = roundMoney((oldStock * oldHpp + quantity * unitCost) / newStock);
		const newSellingPrice = options.updateSellingPrice
			? options.newSellingPrice
			: numeric(product.harga_jual, 'harga_jual');
		const updatedProducts = await supabasePatch(
			`products?id=eq.${encodeURIComponent(productId)}&stok=eq.${encodeURIComponent(String(product.stok))}&harga_pokok=eq.${encodeURIComponent(String(product.harga_pokok))}`,
			{
				stok: newStock,
				harga_pokok: newHpp,
				...(options.updateSellingPrice ? { harga_jual: newSellingPrice } : {})
			}
		);

		if (updatedProducts && updatedProducts.length > 0) {
			return {
				product: updatedProducts[0],
				hppLama: oldHpp,
				hppBaru: newHpp,
				stokBaru: newStock,
				hargaJualBaru: newSellingPrice
			};
		}
	}

	throw apiError('Stok atau HPP berubah bersamaan. Silakan ulangi transaksi.', 409);
}

// Membatalkan perubahan stok jika penyimpanan transaksi berikutnya gagal.
async function compensateStock(productId, change) {
	try {
		await adjustProductStock(productId, change);
	} catch (error) {
		console.error('Kompensasi stok gagal:', error.message);
	}
}

// Mengirim file frontend dengan tipe konten sesuai ekstensi.
function serveStaticFile(response, pathname) {
	let decodedPath;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch (error) {
		sendJson(response, 400, { error: 'Path URL tidak valid.' });
		return;
	}

	const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
	const filePath = path.resolve(FRONTEND_DIR, `.${requestedPath}`);
	if (filePath !== FRONTEND_DIR && !filePath.startsWith(`${FRONTEND_DIR}${path.sep}`)) {
		sendJson(response, 403, { error: 'Akses file ditolak.' });
		return;
	}

	const contentTypes = {
		'.html': 'text/html; charset=utf-8',
		'.css': 'text/css; charset=utf-8',
		'.js': 'text/javascript; charset=utf-8',
		'.json': 'application/json; charset=utf-8',
		'.svg': 'image/svg+xml',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.ico': 'image/x-icon'
	};

	fs.readFile(filePath, (error, content) => {
		if (error) {
			sendJson(response, error.code === 'ENOENT' ? 404 : 500, { error: 'File tidak ditemukan.' });
			return;
		}

		response.writeHead(200, {
			'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type'
		});
		response.end(content);
	});
}

// Mendaftarkan route CRUD sederhana untuk produk dan supplier.
async function handleMasterRoute(request, response, pathname, body) {
	const routes = [
		{ name: 'products', base: '/api/products' },
		{ name: 'suppliers', base: '/api/suppliers' }
	];

	for (const route of routes) {
		if (pathname === route.base && request.method === 'GET') {
			sendJson(response, 200, await supabaseGet(`${route.name}?select=*&order=created_at.desc`));
			return true;
		}

		if (pathname === route.base && request.method === 'POST') {
			if (route.name === 'products') {
				if (!['signature', 'essential'].includes(body.sumber)) {
					throw apiError('sumber harus signature atau essential.', 400);
				}
				const aroma = typeof body.aroma === 'string' ? body.aroma.trim() : '';
				if (!aroma) {
					throw apiError('Aroma wajib diisi.', 400);
				}
				const hargaPokok = numeric(body.harga_pokok, 'harga_pokok');
				const hargaJual = numeric(body.harga_jual, 'harga_jual');
				const stok = numeric(body.stok, 'stok');
				if (hargaPokok < 0 || hargaJual < 0 || !Number.isInteger(stok) || stok < 0) {
					throw apiError('HPP, harga jual, dan stok harus bernilai non-negatif.', 400);
				}
				const existingProducts = await supabaseGet(
					`products?select=id,nama,aroma&sumber=eq.${encodeURIComponent(body.sumber)}`
				);
				const duplicate = existingProducts.find((product) =>
					String(product.aroma || '').trim().toLocaleLowerCase() === aroma.toLocaleLowerCase()
				);
				const prefix = body.sumber === 'signature' ? 'Signature' : 'Essential';
				const nama = `${prefix} ${aroma}`;
				if (duplicate) {
					throw apiError(DUPLICATE_PRODUCT_MESSAGE, 400);
				}
				const product = {
					nama,
					sumber: body.sumber,
					aroma,
					harga_pokok: hargaPokok,
					harga_jual: hargaJual,
					stok
				};
				try {
					sendJson(response, 201, await supabasePost(route.name, product));
				} catch (error) {
					if (error.status === 409) {
						throw apiError(DUPLICATE_PRODUCT_MESSAGE, 400);
					}
					throw error;
				}
				return true;
			}
			sendJson(response, 201, await supabasePost(route.name, body));
			return true;
		}

		if (route.name === 'products' && request.method === 'POST') {
			const stockMatch = pathname.match(/^\/api\/products\/([^/]+)\/add-stock$/);
			if (stockMatch) {
				const quantity = numeric(body.qty_tambah, 'qty_tambah');
				const unitCost = numeric(body.biaya_per_unit, 'biaya_per_unit');
				if (!Number.isInteger(quantity) || quantity <= 0 || unitCost < 0) {
					throw apiError('qty_tambah harus bilangan bulat positif dan biaya_per_unit tidak boleh negatif.', 400);
				}
				if (typeof body.update_harga_jual !== 'boolean') {
					throw apiError('update_harga_jual harus bernilai true atau false.', 400);
				}
				let newSellingPrice;
				if (body.update_harga_jual) {
					newSellingPrice = numeric(body.harga_jual_baru, 'harga_jual_baru');
					if (newSellingPrice < 0) {
						throw apiError('harga_jual_baru tidak boleh negatif.', 400);
					}
				}

				const result = await addProductStockWeightedAverage(stockMatch[1], quantity, unitCost, {
					updateSellingPrice: body.update_harga_jual,
					newSellingPrice
				});
				sendJson(response, 200, {
					success: true,
					hpp_lama: result.hppLama,
					hpp_baru: result.hppBaru,
					stok_baru: result.stokBaru,
					harga_jual_baru: result.hargaJualBaru
				});
				return true;
			}
		}

		const match = pathname.match(new RegExp(`^${route.base}/([^/]+)$`));
		if (!match) {
			continue;
		}

		const resource = `${route.name}?id=eq.${encodeURIComponent(match[1])}`;
		if (request.method === 'GET') {
			const rows = await supabaseGet(`${resource}&select=*`);
			if (!rows || rows.length === 0) {
				throw apiError('Data tidak ditemukan.', 404);
			}
			sendJson(response, 200, rows[0]);
			return true;
		}
		if (request.method === 'PUT') {
			let updateBody = body;
			if (route.name === 'products') {
				updateBody = {};
				for (const field of ['harga_pokok', 'harga_jual', 'stok']) {
					if (body[field] !== undefined) updateBody[field] = numeric(body[field], field);
				}
				if (Object.keys(updateBody).length === 0) {
					throw apiError('Tidak ada harga atau stok yang diperbarui.', 400);
				}
				if (updateBody.harga_pokok < 0 || updateBody.harga_jual < 0 ||
					(updateBody.stok !== undefined && (!Number.isInteger(updateBody.stok) || updateBody.stok < 0))) {
					throw apiError('HPP, harga jual, dan stok harus bernilai non-negatif.', 400);
				}
			}
			const updatedRows = await supabasePatch(resource, updateBody);
			if (!updatedRows || updatedRows.length === 0) {
				throw apiError('Data tidak ditemukan.', 404);
			}
			sendJson(response, 200, updatedRows[0]);
			return true;
		}

		if (request.method === 'DELETE') {
			const deletedRows = await supabaseDelete(resource);
			sendJson(response, 200, { success: true, data: deletedRows });
			return true;
		}
	}

	return false;
}

// Mencatat bahan baku tanpa stok produk atau bahan jadi dengan weighted average.
async function createPurchase(body) {
	const kategori = body.kategori || 'bahan_baku';
	if (!['bahan_baku', 'bahan_jadi', 'lainnya'].includes(kategori)) {
		throw apiError('kategori harus bahan_baku, bahan_jadi, atau lainnya.', 400);
	}
	const productId = body.product_id || null;
	let qty = 0;
	if (kategori === 'bahan_jadi') {
		if (!productId) {
			throw apiError("Kategori 'Bahan Jadi' wajib memilih produk.", 400);
		}
		if (body.qty === undefined || body.qty === null || body.qty === '') {
			throw apiError("Kategori 'Bahan Jadi' wajib mengisi qty.", 400);
		}
		qty = Number(body.qty);
		if (!Number.isInteger(qty) || qty <= 0) {
			throw apiError("Kategori 'Bahan Jadi' wajib mengisi qty.", 400);
		}
	} else if (productId) {
		throw apiError('Kategori ini tidak boleh memilih produk.', 400);
	}
	const dpp = numeric(body.dpp, 'dpp');
	if (dpp < 0 || !body.tanggal) {
		throw apiError('tanggal dan dpp non-negatif wajib valid.', 400);
	}

	const ppnMasukan = roundMoney(dpp * TAX_RATE);
	const purchase = {
		supplier_id: body.supplier_id || null,
		product_id: productId,
		kategori,
		tanggal: body.tanggal,
		keterangan: body.keterangan || null,
		qty,
		dpp,
		ppn_masukan: ppnMasukan,
		total: roundMoney(dpp + ppnMasukan)
	};

	const createdRows = await supabasePost('purchases', purchase);
	const createdPurchase = createdRows && createdRows[0];
	if (!createdPurchase) {
		throw apiError('Supabase tidak mengembalikan data pembelian.', 502);
	}

	if (kategori === 'bahan_jadi') {
		try {
			const weightedAverage = await addProductStockWeightedAverage(
				productId,
				qty,
				dpp / qty
			);
			return {
				...createdPurchase,
				success: true,
				kategori,
				stok_updated: true,
				hpp_updated: true,
				hpp_baru: weightedAverage.hppBaru,
				stok_baru: weightedAverage.stokBaru
			};
		} catch (error) {
			try {
				await supabaseDelete(`purchases?id=eq.${encodeURIComponent(createdPurchase.id)}`);
			} catch (cleanupError) {
				console.error('Penghapusan kompensasi pembelian gagal:', cleanupError.message);
			}
			throw error;
		}
	}

	return { ...createdPurchase, success: true, kategori, stok_updated: false, hpp_updated: false };
}

// Mencatat penjualan, menghitung pajak dan HPP, lalu mengurangi stok secara aman.
async function createSale(body) {
	const qty = numeric(body.qty, 'qty');
	if (!body.product_id || !body.tanggal || !Number.isInteger(qty) || qty <= 0) {
		throw apiError('product_id, tanggal, dan qty positif wajib diisi.', 400);
	}

	const products = await supabaseGet(
		`products?select=id,nama,harga_jual,harga_pokok,stok&id=eq.${encodeURIComponent(body.product_id)}`
	);
	const product = products[0];
	if (!product) {
		throw apiError('Produk tidak ditemukan.', 404);
	}
	if (Number(product.stok) < qty) {
		throw apiError('Stok produk tidak mencukupi.', 409);
	}

	const hargaSatuan = numeric(product.harga_jual, 'harga_jual');
	const dpp = roundMoney(qty * hargaSatuan);
	const ppnKeluaran = roundMoney(dpp * TAX_RATE);
	const hpp = roundMoney(qty * numeric(product.harga_pokok, 'harga_pokok'));
	const sale = {
		product_id: product.id,
		tanggal: body.tanggal,
		customer: body.customer || null,
		qty,
		harga_satuan: hargaSatuan,
		dpp,
		ppn_keluaran: ppnKeluaran,
		hpp,
		total: roundMoney(dpp + ppnKeluaran)
	};

	const createdRows = await supabasePost('sales', sale);
	const createdSale = createdRows && createdRows[0];
	if (!createdSale) {
		throw apiError('Supabase tidak mengembalikan data penjualan.', 502);
	}

	try {
		await adjustProductStock(product.id, -qty);
	} catch (error) {
		try {
			await supabaseDelete(`sales?id=eq.${encodeURIComponent(createdSale.id)}`);
		} catch (cleanupError) {
			console.error('Penghapusan kompensasi penjualan gagal:', cleanupError.message);
		}
		throw error;
	}

	return createdSale;
}

// Menghapus pembelian/penjualan sekaligus membalik perubahan stok transaksi.
async function deleteInventoryTransaction(table, id, stockChange) {
	const fields = table === 'purchases' ? 'id,product_id,qty,kategori' : 'id,product_id,qty';
	const rows = await supabaseGet(`${table}?select=${fields}&id=eq.${encodeURIComponent(id)}`);
	const transaction = rows[0];
	if (!transaction) {
		throw apiError('Transaksi tidak ditemukan.', 404);
	}

	let stockAdjusted = false;
	const affectsStock = table !== 'purchases' || transaction.kategori === 'bahan_jadi';
	if (affectsStock && transaction.product_id && Number(transaction.qty) > 0) {
		await adjustProductStock(transaction.product_id, stockChange * Number(transaction.qty));
		stockAdjusted = true;
	}

	try {
		await supabaseDelete(`${table}?id=eq.${encodeURIComponent(id)}`);
	} catch (error) {
		if (stockAdjusted) {
			await compensateStock(transaction.product_id, -stockChange * Number(transaction.qty));
		}
		throw error;
	}

	return { success: true };
}

// Membangun jurnal dua sisi dari transaksi penjualan dan pembelian pada bulan terpilih.
async function buildJournals(month) {
	const [sales, purchases] = await Promise.all([
		getMonthlyRows('sales', month),
		getMonthlyRows('purchases', month)
	]);
	const journals = [];
	const saleCounters = new Map();
	const purchaseCounters = new Map();
	const nextReference = (counters, prefix, date) => {
		const transactionMonth = String(date).slice(0, 7);
		const counter = (counters.get(transactionMonth) || 0) + 1;
		counters.set(transactionMonth, counter);
		return `${prefix}-${String(counter).padStart(3, '0')}`;
	};

	for (const sale of sales) {
		const description = `Penjualan${sale.customer ? ` - ${sale.customer}` : ''}`;
		const reference = nextReference(saleCounters, 'SALE', sale.tanggal);
		journals.push(
			{ tanggal: sale.tanggal, ref: reference, akun: '101 Kas', debit: Number(sale.total), kredit: 0, keterangan: description },
			{ tanggal: sale.tanggal, ref: reference, akun: '401 Penjualan', debit: 0, kredit: Number(sale.dpp), keterangan: description },
			{ tanggal: sale.tanggal, ref: reference, akun: '211 PPN Keluaran', debit: 0, kredit: Number(sale.ppn_keluaran), keterangan: description },
			{ tanggal: sale.tanggal, ref: reference, akun: '501 HPP', debit: Number(sale.hpp), kredit: 0, keterangan: description },
			{ tanggal: sale.tanggal, ref: reference, akun: '102 Persediaan', debit: 0, kredit: Number(sale.hpp), keterangan: description }
		);
	}

	for (const purchase of purchases) {
		const description = purchase.keterangan || 'Pembelian';
		const reference = nextReference(purchaseCounters, 'PUR', purchase.tanggal);
		let debitAccount;
		switch (purchase.kategori) {
			case 'bahan_baku':
				debitAccount = '104 Persediaan Bahan Baku';
				break;
			case 'bahan_jadi':
				debitAccount = '102 Persediaan Barang Jadi';
				break;
			case 'lainnya':
			default:
				debitAccount = '599 Biaya Lain-lain';
				break;
		}
		journals.push(
			{ tanggal: purchase.tanggal, ref: reference, akun: debitAccount, debit: Number(purchase.dpp), kredit: 0, keterangan: description },
			{ tanggal: purchase.tanggal, ref: reference, akun: '111 PPN Masukan', debit: Number(purchase.ppn_masukan), kredit: 0, keterangan: description },
			{ tanggal: purchase.tanggal, ref: reference, akun: '101 Kas', debit: 0, kredit: Number(purchase.total), keterangan: description }
		);
	}

	const totalDebit = roundMoney(journals.reduce((sum, row) => sum + row.debit, 0));
	const totalKredit = roundMoney(journals.reduce((sum, row) => sum + row.kredit, 0));
	return { journals, total_debit: totalDebit, total_kredit: totalKredit };
}

// Routing API dan static frontend.
async function handleRequest(request, response) {
	const requestUrl = new URL(request.url, 'http://localhost');
	const pathname = decodeURIComponent(requestUrl.pathname).replace(/\/$/, '') || '/';
	const isApiRequest = pathname.startsWith('/api/');

	if (request.method === 'OPTIONS') {
		response.writeHead(204, {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type'
		});
		response.end();
		return;
	}

	if (!isApiRequest && (request.method === 'GET' || request.method === 'HEAD')) {
		serveStaticFile(response, pathname);
		return;
	}

	if (!isApiRequest) {
		sendJson(response, 404, { error: 'Route tidak ditemukan.' });
		return;
	}

	let body = {};
	if (request.method === 'POST' || request.method === 'PUT') {
		body = await readJsonBody(request);
	}
	if (pathname === '/api/aromas' && request.method === 'GET') {
		const rows = await supabaseGet('products?select=aroma&aroma=not.is.null&order=aroma.asc');
		const aromas = [...new Map(rows
			.map((row) => String(row.aroma || '').trim())
			.filter(Boolean)
			.map((aroma) => [aroma.toLocaleLowerCase(), aroma])).values()]
			.sort((left, right) => left.localeCompare(right, 'id'));
		sendJson(response, 200, aromas);
		return;
	}

	if (await handleMasterRoute(request, response, pathname, body)) {
		return;
	}

	if (pathname === '/api/purchases' && request.method === 'GET') {
		sendJson(response, 200, await supabaseGet('purchases?select=*&order=tanggal.desc,created_at.desc'));
		return;
	}
	if (pathname === '/api/purchases' && request.method === 'POST') {
		sendJson(response, 201, await createPurchase(body));
		return;
	}
	const purchaseMatch = pathname.match(/^\/api\/purchases\/([^/]+)$/);
	if (purchaseMatch && request.method === 'DELETE') {
		sendJson(response, 200, await deleteInventoryTransaction('purchases', purchaseMatch[1], -1));
		return;
	}

	if (pathname === '/api/sales' && request.method === 'GET') {
		sendJson(response, 200, await supabaseGet('sales?select=*&order=tanggal.desc,created_at.desc'));
		return;
	}
	if (pathname === '/api/sales' && request.method === 'POST') {
		sendJson(response, 201, await createSale(body));
		return;
	}
	const saleMatch = pathname.match(/^\/api\/sales\/([^/]+)$/);
	if (saleMatch && request.method === 'DELETE') {
		sendJson(response, 200, await deleteInventoryTransaction('sales', saleMatch[1], 1));
		return;
	}

	if (pathname === '/api/report/ppn' && request.method === 'GET') {
		const month = requestUrl.searchParams.get('bulan');
		const [sales, purchases] = await Promise.all([
			getMonthlyRows('sales', month),
			getMonthlyRows('purchases', month)
		]);
		const dppJual = sumField(sales, 'dpp');
		const ppnKeluaran = sumField(sales, 'ppn_keluaran');
		const dppBeli = sumField(purchases, 'dpp');
		const ppnMasukan = sumField(purchases, 'ppn_masukan');
		const selisih = roundMoney(ppnKeluaran - ppnMasukan);
		const status = selisih > 0 ? 'Kurang Bayar' : selisih < 0 ? 'Lebih Bayar' : 'Nihil';
		sendJson(response, 200, {
			dpp_jual: dppJual,
			ppn_keluaran: ppnKeluaran,
			dpp_beli: dppBeli,
			ppn_masukan: ppnMasukan,
			selisih,
			status
		});
		return;
	}

	if (pathname === '/api/report/laba-rugi' && request.method === 'GET') {
		const [sales, purchases] = await Promise.all([
			getMonthlyRows('sales', requestUrl.searchParams.get('bulan')),
			getMonthlyRows('purchases', requestUrl.searchParams.get('bulan'))
		]);
		const penjualan = sumField(sales, 'dpp');
		const hpp = sumField(sales, 'hpp');
		const laba_kotor = roundMoney(penjualan - hpp);
		const biaya_lain = sumField(purchases.filter((purchase) => purchase.kategori === 'lainnya'), 'dpp');
		const laba_bersih = roundMoney(laba_kotor - biaya_lain);
		sendJson(response, 200, { penjualan, hpp, laba_kotor, biaya_lain, laba_bersih });
		return;
	}

	if (pathname === '/api/journals' && request.method === 'GET') {
		sendJson(response, 200, await buildJournals(requestUrl.searchParams.get('bulan')));
		return;
	}

	sendJson(response, 404, { error: 'Endpoint API tidak ditemukan.' });
}

// Server mencatat setiap request, menerapkan CORS, dan menangani error API.
const server = http.createServer(async (request, response) => {
	console.log(`${new Date().toISOString()} ${request.method} ${request.url}`);

	try {
		await handleRequest(request, response);
	} catch (error) {
		console.error('Request gagal:', error.message);
		if (response.headersSent) {
			response.destroy();
			return;
		}
		sendJson(response, error.status || 500, { error: error.message || 'Terjadi kesalahan pada server.' });
	}
});

server.listen(PORT, () => {
	console.log(`Sistem PPN Lilin Aromaterapi berjalan di http://localhost:${PORT}`);
});
