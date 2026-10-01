"use client";

import Link from "next/link";
import { useId, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, ImageIcon, Move, Package, ShoppingBag, Store, Truck } from "lucide-react";
import { relatedProducts, type CatalogProduct } from "@/lib/commerce";
import "./product-view.css";

type Props = {
  product: CatalogProduct;
  products: CatalogProduct[];
  inCart: number;
  onAdd: (id: string) => void;
  onOpenCart: () => void;
};

const money = (value: number) => `${Number(value).toFixed(2)} AZN`;

function ProductImage({ product }: { product: CatalogProduct }) {
  const hintId = useId();
  const frame = useRef<HTMLButtonElement>(null);
  const position = useRef({ x: 50, y: 50 });
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [failed, setFailed] = useState(false);
  const zoomed = hover || pinned;
  const hasImage = Boolean(product.image) && !failed;

  function place(x: number, y: number) {
    position.current = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    frame.current?.style.setProperty("--pd-origin", `${position.current.x}% ${position.current.y}%`);
  }

  function follow(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    place(((event.clientX - bounds.left) / bounds.width) * 100, ((event.clientY - bounds.top) / bounds.height) * 100);
  }

  return <div className="pd-gallery">
    <button
      ref={frame}
      className={`pd-image-frame${zoomed ? " pd-image-zoomed" : ""}`}
      type="button"
      disabled={!hasImage}
      aria-label={`${product.name} — şəkli ${zoomed ? "kiçilt" : "böyüt"}`}
      aria-pressed={zoomed}
      aria-describedby={hintId}
      style={{ touchAction: pinned ? "none" : "pan-y" }}
      onPointerEnter={event => { if (event.pointerType === "mouse") { follow(event); setHover(true); } }}
      onPointerLeave={event => { if (event.pointerType === "mouse") setHover(false); }}
      onPointerDown={event => {
        if (event.pointerType === "mouse") return;
        touch.current = { x: event.clientX, y: event.clientY, moved: false };
        if (pinned) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (event.pointerType === "mouse") { follow(event); return; }
        if (touch.current && Math.hypot(event.clientX - touch.current.x, event.clientY - touch.current.y) > 8) touch.current.moved = true;
        if (pinned) follow(event);
      }}
      onPointerUp={event => {
        if (event.pointerType === "mouse") return;
        if (touch.current && !touch.current.moved) { follow(event); setPinned(value => !value); }
        touch.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { touch.current = null; }}
      onClick={event => { if (event.detail === 0) { place(50, 50); setPinned(value => !value); } }}
      onKeyDown={event => {
        if (event.key === "Escape") { setHover(false); setPinned(false); place(50, 50); }
        if (zoomed && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault();
          place(position.current.x + (event.key === "ArrowRight" ? 10 : event.key === "ArrowLeft" ? -10 : 0), position.current.y + (event.key === "ArrowDown" ? 10 : event.key === "ArrowUp" ? -10 : 0));
        }
      }}
      onBlur={() => { setPinned(false); setHover(false); }}
    >
      {hasImage ? <img className="pd-main-image" src={product.image} alt={product.name} draggable={false} onError={() => setFailed(true)} /> : <span className="pd-no-image"><ImageIcon size={52} strokeWidth={1} /><span>Şəkil əlavə edilməyib</span></span>}
      {product.originalPrice > product.price && <span className="pd-discount-badge">−{Math.round((1 - product.price / product.originalPrice) * 100)}%</span>}
    </button>
    <p className="pd-image-hint" id={hintId}><Move size={15} aria-hidden="true" /><span className="pd-desktop-hint">Detalları görmək üçün siçanı şəkil üzərində hərəkət etdirin.</span><span className="pd-touch-hint">Böyütmək üçün toxunun, baxmaq üçün sürüşdürün.</span><span className="pd-sr-only">Klaviatura: Enter ilə böyüdün, oxlarla hərəkət edin, Escape ilə kiçildin.</span></p>
  </div>;
}

export default function ProductView({ product, products, inCart, onAdd, onOpenCart }: Props) {
  const related = relatedProducts(product, products);
  const specifications = (product.specifications || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  return <div className="pd-page">
    <nav className="pd-breadcrumb" aria-label="Səhifə yolu">
      <Link href="/">Ana səhifə</Link><ChevronRight size={13} aria-hidden="true" />
      <Link href="/#catalog">Kataloq</Link><ChevronRight size={13} aria-hidden="true" />
      <span aria-current="page">{product.name}</span>
    </nav>

    <section className="pd-layout" aria-labelledby="pd-product-title">
      <ProductImage key={product.id} product={product} />
      <div className="pd-summary">
        <Link href="/#catalog" className="pd-back"><ArrowLeft size={15} aria-hidden="true" /> Kataloqa qayıt</Link>
        <p className="pd-eyebrow">{product.category || "Kolleksiyamızdan"}</p>
        <h1 id="pd-product-title" className="pd-title">{product.name}</h1>
        <p className={`pd-stock${product.available ? "" : " pd-stock-empty"}`}><span aria-hidden="true" />{product.available ? "Anbarda mövcuddur" : "Hazırda stokda yoxdur"}<span className="pd-stock-unit">/ {product.unit || "ədəd"}</span></p>
        <div className="pd-price-row">
          <strong className="pd-price">{money(product.price)}</strong>
          {product.originalPrice > product.price && <del className="pd-old-price">{money(product.originalPrice)}</del>}
        </div>
        {product.originalPrice > product.price && <p className="pd-saving">{money(product.originalPrice - product.price)} qənaət edirsiniz</p>}
        <p className="pd-intro">{product.description || "Məhsul haqqında sualınız var? Əlaqə bölməsindən bizə yazın, seçim etməkdə kömək edək."}</p>
        <div className="pd-purchase">
          <button className="pd-add-button" type="button" disabled={!product.available || inCart >= 100} onClick={() => onAdd(product.id)}><ShoppingBag size={19} aria-hidden="true" />{!product.available ? "Stokda yoxdur" : inCart >= 100 ? "Miqdar limiti: 100" : "Səbətə əlavə et"}<ArrowRight size={18} aria-hidden="true" /></button>
          {inCart > 0 && <button className="pd-cart-link" type="button" onClick={onOpenCart}><Check size={16} aria-hidden="true" /><span>Səbətinizdə {inCart} {product.unit || "ədəd"} var</span><span>Səbətə bax →</span></button>}
          <p className="pd-purchase-note">Miqdarı səbətdə dəyişə və sifarişi oradan tamamlaya bilərsiniz.</p>
        </div>
        <div className="pd-fulfillment">
          <div><Store size={20} strokeWidth={1.5} aria-hidden="true" /><p><strong>Mağazadan götürmə</strong><span>Sifariş hazır olduqda hesabınızda görünəcək.</span></p></div>
          <div><Truck size={20} strokeWidth={1.5} aria-hidden="true" /><p><strong>Ünvana çatdırılma</strong><span>Sifariş zamanı ünvanınızı qeyd edin.</span></p></div>
          <div><Package size={20} strokeWidth={1.5} aria-hidden="true" /><p><strong>Sifarişiniz nəzarətinizdə</strong><span>Mərhələləri şəxsi hesabınızdan izləyin.</span></p></div>
        </div>
      </div>
    </section>

    <section className="pd-information" aria-labelledby="pd-info-title">
      <div className="pd-info-heading"><p className="pd-eyebrow">Daha yaxından tanıyın</p><h2 className="pd-section-title" id="pd-info-title">Məhsul haqqında</h2></div>
      <div className="pd-info-content">
        <p className="pd-description">{product.description || "Bu məhsula aid əlavə açıqlama hələ daxil edilməyib. Ətraflı məlumat üçün bizimlə əlaqə saxlaya bilərsiniz."}</p>
        <dl className="pd-specifications">
          <div><dt>Kateqoriya</dt><dd>{product.category || "Ümumi"}</dd></div>
          <div><dt>Satış vahidi</dt><dd>{product.unit || "ədəd"}</dd></div>
          {specifications.map((line, index) => {
            const separator = line.indexOf(":");
            const label = separator > 0 ? line.slice(0, separator).trim() : "Xüsusiyyət";
            const value = separator > 0 ? line.slice(separator + 1).trim() : line;
            return <div key={`${index}-${line}`}><dt>{label}</dt><dd>{value}</dd></div>;
          })}
        </dl>
      </div>
    </section>

    {related.length > 0 && <section className="pd-related" aria-labelledby="pd-related-title">
      <div className="pd-related-heading"><div><p className="pd-eyebrow">Seçiminizi tamamlayın</p><h2 className="pd-section-title" id="pd-related-title">Bunlar da xoşunuza gələ bilər</h2></div><Link href="/#catalog">Bütün məhsullar <ArrowRight size={17} aria-hidden="true" /></Link></div>
      <div className="pd-related-grid">{related.map(item => <Link className="pd-related-card" key={item.id} href={`/products/${item.id}`}>
        <div className="pd-related-image">{item.image ? <img src={item.image} alt={item.name} loading="lazy" /> : <ImageIcon size={40} strokeWidth={1} aria-hidden="true" />}{item.originalPrice > item.price && <span className="pd-related-sale">Endirim</span>}</div>
        <div className="pd-related-body"><p className="pd-related-category">{item.category || "Məhsul"}</p><h3 className="pd-related-name">{item.name}</h3><div className="pd-related-bottom"><strong>{money(item.price)}</strong><span className="pd-related-arrow"><ArrowRight size={18} aria-hidden="true" /></span></div></div>
      </Link>)}</div>
    </section>}
  </div>;
}
