"use client";

import { useState } from "react";

type Insurer = { id: string; name: string; products: { id: string; name: string }[] };

/** Campos do envio: o produto depende da seguradora escolhida. */
export function UploadFields({
  insurers,
  docTypes,
  defaults,
}: {
  insurers: Insurer[];
  docTypes: [string, string][];
  defaults?: { title?: string; insurerId?: string | null; productId?: string | null; docType?: string };
}) {
  const [insurer, setInsurer] = useState(defaults?.insurerId ?? "");
  const products = insurers.find((i) => i.id === insurer)?.products ?? [];
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <div className="form-grid">
      <div className="field span-all">
        <label htmlFor="arquivo">Arquivo PDF</label>
        <input id="arquivo" name="arquivo" type="file" accept="application/pdf,.pdf" required className="input" style={{ paddingTop: 10 }}
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} aria-describedby="arquivo-ajuda" />
        <span id="arquivo-ajuda" className="help">Até 25 MB. O PDF precisa ter texto selecionável; documentos escaneados como imagem ainda não são aceitos.</span>
      </div>
      <div className="field span-all">
        <label htmlFor="titulo">Título</label>
        <input id="titulo" name="titulo" className="input" maxLength={200} defaultValue={defaults?.title}
          placeholder={fileName ? fileName.replace(/\.pdf$/i, "") : "Ex.: Condições gerais — Auto Clássico"} />
        <span className="help">É o nome que aparece nas fontes citadas. Se ficar vazio, usamos o nome do arquivo.</span>
      </div>
      <div className="field">
        <label htmlFor="seguradora">Seguradora</label>
        <select id="seguradora" name="seguradora" className="select" value={insurer} onChange={(e) => setInsurer(e.target.value)}>
          <option value="">Sem seguradora (documento interno)</option>
          {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="produto">Produto</label>
        <select id="produto" name="produto" className="select" defaultValue={defaults?.productId ?? ""} disabled={!products.length} key={insurer}>
          <option value="">{products.length ? "Não especificar" : "Nenhum produto cadastrado"}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="tipo">Tipo de documento</label>
        <select id="tipo" name="tipo" className="select" defaultValue={defaults?.docType ?? "condicoes_gerais"}>
          {docTypes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="vigencia_inicio">Vigência — início</label>
        <input id="vigencia_inicio" name="vigencia_inicio" type="date" className="input" />
      </div>
      <div className="field">
        <label htmlFor="vigencia_fim">Vigência — fim</label>
        <input id="vigencia_fim" name="vigencia_fim" type="date" className="input" aria-describedby="fim-ajuda" />
        <span id="fim-ajuda" className="help">Com a data, a resposta avisa quando o documento estiver vencido.</span>
      </div>
      <label className="check span-all">
        <input type="checkbox" name="direitos" required />
        <span>Confirmo que a corretora tem direito de usar este documento na plataforma (por exemplo, material público da seguradora ou recebido para uso comercial).</span>
      </label>
    </div>
  );
}
