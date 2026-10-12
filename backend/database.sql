-- Sistem PPN Lilin Aromaterapi
-- Jalankan skrip ini di Supabase SQL Editor.

-- Master produk: HPP dan harga jual disimpan per unit; stok dikelola secara perpetual.
CREATE TABLE IF NOT EXISTS public.products (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	nama text NOT NULL,
	aroma text,
	harga_pokok numeric NOT NULL DEFAULT 0,
	harga_jual numeric NOT NULL DEFAULT 0,
	stok integer NOT NULL DEFAULT 0,
	created_at timestamptz DEFAULT now()
);

ALTER TABLE public.products
	ADD COLUMN IF NOT EXISTS sumber text;

ALTER TABLE public.products
	DROP CONSTRAINT IF EXISTS products_sumber_check;

UPDATE public.products
SET sumber = 'signature'
WHERE sumber IN ('homemade', 'produksi') OR sumber IS NULL;

UPDATE public.products
SET sumber = 'essential'
WHERE sumber IN ('beli_jadi', 'premium', 'common');

ALTER TABLE public.products
	ALTER COLUMN sumber SET DEFAULT 'signature';

ALTER TABLE public.products
	ALTER COLUMN sumber SET NOT NULL;

ALTER TABLE public.products
	ADD CONSTRAINT products_sumber_check
	CHECK (sumber IN ('signature', 'essential'));

ALTER TABLE public.products
	DROP CONSTRAINT IF EXISTS products_sumber_aroma_unique;

ALTER TABLE public.products
	ADD CONSTRAINT products_sumber_aroma_unique UNIQUE (sumber, aroma);

COMMENT ON TABLE public.products IS 'Master produk lilin aromaterapi, termasuk HPP per unit dan stok.';
COMMENT ON COLUMN public.products.sumber IS 'Jenis produk: signature (produksi sendiri) atau essential (beli jadi).';
COMMENT ON COLUMN public.products.harga_pokok IS 'Harga pokok/modal untuk satu unit produk.';
COMMENT ON COLUMN public.products.stok IS 'Jumlah stok produk yang tersedia.';

-- Master pemasok.
CREATE TABLE IF NOT EXISTS public.suppliers (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	nama text NOT NULL,
	npwp text,
	alamat text,
	created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.suppliers IS 'Master pemasok bahan dan produk.';

-- Pembelian: PPN masukan dicatat sebesar 11% dari DPP.
CREATE TABLE IF NOT EXISTS public.purchases (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
	product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
	kategori text DEFAULT 'bahan_baku',
	tanggal date NOT NULL,
	keterangan text,
	qty integer DEFAULT 0,
	dpp numeric NOT NULL DEFAULT 0,
	ppn_masukan numeric NOT NULL DEFAULT 0,
	total numeric NOT NULL DEFAULT 0,
	created_at timestamptz DEFAULT now()
);

ALTER TABLE public.purchases
	ADD COLUMN IF NOT EXISTS kategori text DEFAULT 'bahan_baku';

ALTER TABLE public.purchases
	ALTER COLUMN kategori SET DEFAULT 'bahan_baku';

UPDATE public.purchases
SET kategori = 'bahan_baku'
WHERE kategori IS NULL;

ALTER TABLE public.purchases
	DROP CONSTRAINT IF EXISTS purchases_kategori_check;

ALTER TABLE public.purchases
	ADD CONSTRAINT purchases_kategori_check
	CHECK (kategori IN ('bahan_baku', 'bahan_jadi', 'lainnya'));

COMMENT ON TABLE public.purchases IS 'Transaksi pembelian dengan pencatatan DPP dan PPN masukan.';
COMMENT ON COLUMN public.purchases.ppn_masukan IS 'PPN masukan, dihitung sebesar 11% dari DPP.';
COMMENT ON COLUMN public.purchases.kategori IS 'Kategori pembelian: bahan baku, bahan jadi, atau lainnya.';

-- Penjualan: harga_satuan dan DPP dicatat sebelum PPN; HPP merupakan total HPP barang terjual.
CREATE TABLE IF NOT EXISTS public.sales (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
	tanggal date NOT NULL,
	customer text,
	qty integer NOT NULL,
	harga_satuan numeric NOT NULL,
	dpp numeric NOT NULL,
	ppn_keluaran numeric NOT NULL,
	hpp numeric NOT NULL,
	total numeric NOT NULL,
	created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.sales IS 'Transaksi penjualan dengan DPP, PPN keluaran, dan total HPP.';
COMMENT ON COLUMN public.sales.ppn_keluaran IS 'PPN keluaran, dihitung sebesar 11% dari DPP.';
COMMENT ON COLUMN public.sales.hpp IS 'Total harga pokok penjualan: qty dikalikan HPP per unit.';

-- Prototype tanpa autentikasi: izinkan anon membaca dan mengubah seluruh baris.
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow all" ON public.products;
CREATE POLICY "allow all" ON public.products
	FOR ALL TO anon
	USING (true)
	WITH CHECK (true);

DROP POLICY IF EXISTS "allow all" ON public.suppliers;
CREATE POLICY "allow all" ON public.suppliers
	FOR ALL TO anon
	USING (true)
	WITH CHECK (true);

DROP POLICY IF EXISTS "allow all" ON public.purchases;
CREATE POLICY "allow all" ON public.purchases
	FOR ALL TO anon
	USING (true)
	WITH CHECK (true);

DROP POLICY IF EXISTS "allow all" ON public.sales;
CREATE POLICY "allow all" ON public.sales
	FOR ALL TO anon
	USING (true)
	WITH CHECK (true);

-- Seed produk. Nilai stok mencerminkan kuantitas awal dikurangi contoh penjualan.
INSERT INTO public.products (id, nama, aroma, harga_pokok, harga_jual, stok)
VALUES
	('10000000-0000-4000-8000-000000000001', 'Lilin Lavender', 'Lavender', 25000, 75000, 15),
	('10000000-0000-4000-8000-000000000002', 'Lilin Vanilla', 'Vanilla', 30000, 85000, 13),
	('10000000-0000-4000-8000-000000000003', 'Lilin Rose', 'Rose', 28000, 80000, 12)
ON CONFLICT (id) DO NOTHING;

-- Seed pemasok contoh.
INSERT INTO public.suppliers (id, nama, npwp, alamat)
VALUES
	('20000000-0000-4000-8000-000000000001', 'PT Aroma Nusantara', '01.234.567.8-901.000', 'Semarang'),
	('20000000-0000-4000-8000-000000000002', 'CV Bahan Wangi Sejahtera', '02.345.678.9-012.000', 'Yogyakarta')
ON CONFLICT (id) DO NOTHING;

-- Seed pembelian. Total merupakan DPP ditambah PPN masukan 11%.
INSERT INTO public.purchases
	(id, supplier_id, product_id, kategori, tanggal, keterangan, qty, dpp, ppn_masukan, total)
VALUES
	('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'bahan_jadi', '2026-09-01', 'Pembelian lilin lavender', 20, 500000, 55000, 555000),
	('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'bahan_jadi', '2026-09-03', 'Pembelian lilin vanilla', 15, 450000, 49500, 499500)
ON CONFLICT (id) DO NOTHING;

-- Seed penjualan. HPP adalah qty x harga_pokok; total adalah DPP + PPN keluaran.
INSERT INTO public.sales
	(id, product_id, tanggal, customer, qty, harga_satuan, dpp, ppn_keluaran, hpp, total)
VALUES
	('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-09-10', 'Pelanggan A', 2, 75000, 150000, 16500, 50000, 166500),
	('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-09-12', 'Pelanggan B', 3, 75000, 225000, 24750, 75000, 249750),
	('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '2026-09-15', 'Pelanggan C', 2, 85000, 170000, 18700, 60000, 188700)
ON CONFLICT (id) DO NOTHING;
