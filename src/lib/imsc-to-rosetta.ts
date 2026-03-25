const TTML_NS = "http://www.w3.org/ns/ttml";
const TTS_NS = "http://www.w3.org/ns/ttml#styling";

interface Subtitle {
  begin: string;
  end: string;
  region: string;
  spans: { text: string; italic: boolean; bold: boolean }[];
}

interface RegionInfo {
  id: string;
  displayAlign: string;
  origin: string;
  extent: string;
}

export function convertImscToRosetta(xmlString: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Error al parsear el XML: " + parseError.textContent);
  }

  const tt = doc.documentElement;

  // Extract attributes from <tt>
  const lang = tt.getAttribute("xml:lang") || "en";
  const frameRate = tt.getAttributeNS("http://www.w3.org/ns/ttml#parameter", "frameRate") || "25";
  const frameRateMultiplier = tt.getAttributeNS("http://www.w3.org/ns/ttml#parameter", "frameRateMultiplier") || "1 1";

  // Extract regions
  const regionElements = doc.getElementsByTagNameNS(TTML_NS, "region");
  const regionMap = new Map<string, RegionInfo>();
  let regionCounter = 0;

  for (let i = 0; i < regionElements.length; i++) {
    const el = regionElements[i];
    const originalId = el.getAttribute("xml:id") || "";
    const displayAlign = el.getAttributeNS(TTS_NS, "displayAlign") || "after";
    const origin = el.getAttributeNS(TTS_NS, "origin") || "10% 10%";
    const extent = el.getAttributeNS(TTS_NS, "extent") || "80% 80%";

    // Map to Rosetta region IDs: R0 for after, R10 for before
    let rosettaId: string;
    if (displayAlign === "before") {
      rosettaId = "R10";
    } else {
      rosettaId = "R" + regionCounter;
      regionCounter++;
    }

    regionMap.set(originalId, {
      id: rosettaId,
      displayAlign,
      origin: normalizeOriginExtent(origin),
      extent: normalizeOriginExtent(extent),
    });
  }

  // If no regions found, create a default one
  if (regionMap.size === 0) {
    regionMap.set("default", {
      id: "R0",
      displayAlign: "after",
      origin: "10% 10%",
      extent: "80% 80%",
    });
  }

  // Extract subtitles from <p> elements
  const subtitles: Subtitle[] = [];
  const pElements = doc.getElementsByTagNameNS(TTML_NS, "p");
  let hasItalic = false;
  let hasBold = false;

  for (let i = 0; i < pElements.length; i++) {
    const p = pElements[i];
    const begin = normalizeTime(p.getAttribute("begin") || "");
    const end = normalizeTime(p.getAttribute("end") || "");
    const regionRef = p.getAttribute("region") || "";

    if (!begin || !end) continue;

    const mappedRegion = regionMap.get(regionRef);
    const rosettaRegion = mappedRegion ? mappedRegion.id : "R0";

    const spans = extractSpans(p);
    spans.forEach(s => {
      if (s.italic) hasItalic = true;
      if (s.bold) hasBold = true;
    });

    subtitles.push({ begin, end, region: rosettaRegion, spans });
  }

  // Determine which unique regions are actually used
  const usedRegionIds = new Set(subtitles.map(s => s.region));
  const rosettaRegions: RegionInfo[] = [];
  const seenRosettaIds = new Set<string>();

  for (const info of regionMap.values()) {
    if (usedRegionIds.has(info.id) && !seenRosettaIds.has(info.id)) {
      rosettaRegions.push(info);
      seenRosettaIds.add(info.id);
    }
  }

  // Build output XML
  return buildRosettaXml({
    lang,
    frameRate,
    frameRateMultiplier,
    regions: rosettaRegions,
    subtitles,
    hasItalic,
    hasBold,
  });
}

function extractSpans(p: Element): Subtitle["spans"] {
  const spans: Subtitle["spans"] = [];
  const children = p.childNodes;

  for (let i = 0; i < children.length; i++) {
    const node = children[i];

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.trim()) {
        spans.push({ text, italic: false, bold: false });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      const localName = el.localName;

      if (localName === "br") {
        // Bare <br/> — will be wrapped in <span><br/></span>
        spans.push({ text: "\n", italic: false, bold: false });
      } else if (localName === "span") {
        const italic =
          el.getAttributeNS(TTS_NS, "fontStyle") === "italic" ||
          hasStyleContaining(el, "italic");
        const bold =
          el.getAttributeNS(TTS_NS, "fontWeight") === "bold" ||
          hasStyleContaining(el, "bold");

        // Check if span contains a <br/>
        const innerBr = el.getElementsByTagNameNS(TTML_NS, "br");
        if (innerBr.length > 0 && !el.textContent?.trim()) {
          spans.push({ text: "\n", italic: false, bold: false });
        } else {
          const text = el.textContent || "";
          if (text) {
            spans.push({ text, italic, bold });
          }
        }
      }
    }
  }

  return spans;
}

function hasStyleContaining(el: Element, keyword: string): boolean {
  const style = el.getAttribute("style") || "";
  return style.toLowerCase().includes(keyword);
}

function normalizeTime(time: string): string {
  if (!time) return "";

  // Already in HH:MM:SS.TTT format
  const match = time.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d+)$/);
  if (match) {
    const [, hh, mm, ss, frac] = match;
    // Ensure exactly 3 decimal places
    const ms = frac.padEnd(3, "0").slice(0, 3);
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  // Frame-based format: HH:MM:SS:FF (not expected with current EZTitles settings but handle it)
  const frameMatch = time.match(/^(\d{2}):(\d{2}):(\d{2}):(\d+)$/);
  if (frameMatch) {
    const [, hh, mm, ss, ff] = frameMatch;
    // Convert frames to milliseconds (approximate, assuming 30fps)
    const ms = Math.round((parseInt(ff) / 30) * 1000)
      .toString()
      .padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  return time;
}

function normalizeOriginExtent(value: string): string {
  // Ensure values like "10% 50%" stay as-is, but normalize "10% 10%" format
  return value.trim();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

interface BuildParams {
  lang: string;
  frameRate: string;
  frameRateMultiplier: string;
  regions: RegionInfo[];
  subtitles: Subtitle[];
  hasItalic: boolean;
  hasBold: boolean;
}

function buildRosettaXml(params: BuildParams): string {
  const {
    lang,
    frameRate,
    frameRateMultiplier,
    regions,
    subtitles,
    hasItalic,
    hasBold,
  } = params;

  const lines: string[] = [];

  // XML declaration
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>');

  // <tt> with all Rosetta namespaces
  lines.push(
    `<tt xmlns:rosetta="https://github.com/imsc-rosetta/specification"` +
      ` xmlns:ttp="http://www.w3.org/ns/ttml#parameter"` +
      ` xmlns:itts="http://www.w3.org/ns/ttml/profile/imsc1#styling"` +
      ` xmlns:ebutts="urn:ebu:tt:style"` +
      ` xmlns:ttm="http://www.w3.org/ns/ttml#metadata"` +
      ` xmlns:tts="http://www.w3.org/ns/ttml#styling"` +
      ` xml:lang="${escapeXml(lang)}"` +
      ` xml:space="preserve"` +
      ` xmlns:xml="http://www.w3.org/XML/1998/namespace"` +
      ` ttp:cellResolution="30 15"` +
      ` ttp:frameRateMultiplier="${escapeXml(frameRateMultiplier)}"` +
      ` ttp:timeBase="media"` +
      ` ttp:frameRate="${escapeXml(frameRate)}"` +
      ` xmlns="http://www.w3.org/ns/ttml">`
  );

  // <head>
  lines.push("  <head>");

  // <metadata>
  lines.push("    <metadata>");
  lines.push("      <rosetta:format>imsc-rosetta</rosetta:format>");
  lines.push("      <rosetta:version>0.0.0</rosetta:version>");
  lines.push("    </metadata>");

  // <styling>
  lines.push("    <styling>");
  lines.push('      <style xml:id="d_default" style="_d_default" />');
  lines.push(
    '      <style xml:id="r_default" style="_r_default" tts:backgroundColor="#00000000" tts:fontFamily="proportionalSansSerif" tts:fontStyle="normal" tts:fontWeight="normal" tts:overflow="visible" tts:showBackground="whenActive" tts:wrapOption="noWrap" />'
  );
  lines.push('      <style xml:id="_d_default" style="d_outline" />');
  lines.push(
    '      <style xml:id="_r_quantisationregion" tts:fontSize="5.333rh" tts:lineHeight="125%" tts:origin="10% 10%" tts:extent="80% 80%" />'
  );
  lines.push(
    '      <style xml:id="_r_default" style="s_fg_white p_al_center" tts:fontSize="5.333rh" tts:lineHeight="125%" tts:luminanceGain="1.0" itts:fillLineGap="false" ebutts:linePadding="0.25c" />'
  );
  lines.push(
    '      <style xml:id="p_al_center" tts:textAlign="center" ebutts:multiRowAlign="center" />'
  );
  lines.push('      <style xml:id="s_fg_white" tts:color="#FFFFFF" />');
  lines.push(
    '      <style xml:id="s_outlineblack" tts:textOutline="#000000 0.05em" />'
  );
  lines.push('      <style xml:id="d_outline" style="s_outlineblack" />');
  lines.push(
    '      <style xml:id="p_font1" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:lineHeight="125%" />'
  );
  lines.push(
    '      <style xml:id="p_font2" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:lineHeight="125%" />'
  );
  if (hasItalic) {
    lines.push('      <style xml:id="s_italic" tts:fontStyle="italic" />');
  }
  if (hasBold) {
    lines.push('      <style xml:id="s_bold" tts:fontWeight="bold" />');
  }
  lines.push("    </styling>");

  // <layout>
  lines.push("    <layout>");
  // Sort regions: R0 first, then R10
  const sortedRegions = [...regions].sort((a, b) => {
    const numA = parseInt(a.id.replace("R", ""));
    const numB = parseInt(b.id.replace("R", ""));
    return numA - numB;
  });
  for (const region of sortedRegions) {
    lines.push(
      `      <region xml:id="${region.id}" style="r_default" tts:displayAlign="${region.displayAlign}" tts:origin="${region.origin}" tts:extent="${region.extent}" />`
    );
  }
  lines.push("    </layout>");

  lines.push("  </head>");

  // <body>
  lines.push("  <body>");

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    const id = `e_${i + 1}`;

    // Build <p> content
    const pContent = buildPContent(sub.spans);

    lines.push(
      `    <div xml:id="${id}" region="${sub.region}" style="d_default" begin="${sub.begin}" end="${sub.end}">`
    );
    lines.push(`      <p style="p_font1">${pContent}</p>`);
    lines.push("    </div>");
  }

  lines.push("  </body>");
  lines.push("</tt>");

  return lines.join("\n");
}

function buildPContent(spans: Subtitle["spans"]): string {
  let result = "";

  for (const span of spans) {
    if (span.text === "\n") {
      result += "<span><br/></span>";
    } else {
      const styles: string[] = [];
      if (span.italic) styles.push("s_italic");
      if (span.bold) styles.push("s_bold");

      const styleAttr =
        styles.length > 0 ? ` style="${styles.join(" ")}"` : "";
      result += `<span${styleAttr}>${escapeXml(span.text)}</span>`;
    }
  }

  return result;
}
