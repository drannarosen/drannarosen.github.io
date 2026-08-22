<?xml version="1.0" encoding="UTF-8"?>
<!--
  rss.xsl — makes the Astrobytes feed readable when a person opens it.

  A browser given raw XML prints "This XML file does not appear to have any
  style information", which looks like a broken page to anyone who clicks a
  feed link expecting to read something. Feed readers ignore this stylesheet
  entirely; it only affects humans.

  Colours are copied from src/styles/tokens.css rather than imported, because
  an XSLT transform cannot use the site's stylesheet. Keep them in step by
  hand: bg-void #0f1115, bg-deep #171b22, spec-teal-bright #4fd6c4.
  (Token names are written without their leading dashes on purpose: an XML
  comment may not contain a double hyphen, and doing so makes this file
  malformed XML that no browser will apply.)
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:site="https://anna-rosen.com/ns/provenance">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>

  <xsl:template match="/rss/channel">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="title"/> — feed</title>
        <style>
          :root { color-scheme: dark; }
          body {
            margin: 0; padding: 2.5rem 1.25rem 4rem;
            background: #0f1115;
            color: rgba(255,255,255,0.9);
            font-family: "Source Sans 3", ui-sans-serif, system-ui, -apple-system, sans-serif;
            line-height: 1.6;
          }
          .wrap { max-inline-size: 46rem; margin-inline: auto; }
          .eyebrow {
            font-family: ui-monospace, "SF Mono", "JetBrains Mono", monospace;
            font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase;
            color: #4fd6c4; margin: 0 0 0.5rem;
          }
          h1 { font-size: 1.9rem; line-height: 1.2; margin: 0 0 0.5rem; }
          .desc { color: rgba(255,255,255,0.66); margin: 0 0 1.5rem; }
          .note {
            background: #171b22; border: 1px solid rgba(255,255,255,0.09);
            border-radius: 10px; padding: 0.9rem 1.1rem; margin-bottom: 2.25rem;
            color: rgba(255,255,255,0.66); font-size: 0.95rem;
          }
          .note code {
            font-family: ui-monospace, "SF Mono", monospace; color: #4fd6c4;
            font-size: 0.88rem; word-break: break-all;
          }
          a { color: #4fd6c4; }
          article {
            padding-block: 1.35rem;
            border-block-start: 1px solid rgba(255,255,255,0.09);
          }
          article h2 { font-size: 1.2rem; margin: 0 0 0.3rem; }
          article h2 a { text-decoration: none; }
          article h2 a:hover { text-decoration: underline; }
          .meta {
            font-family: ui-monospace, "SF Mono", monospace;
            font-size: 0.76rem; color: rgba(255,255,255,0.48);
            display: flex; flex-wrap: wrap; gap: 0.35rem 0.9rem; margin-bottom: 0.4rem;
          }
          .dek { color: rgba(255,255,255,0.66); margin: 0 0 0.5rem; }
          .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
          .tag {
            font-family: ui-monospace, "SF Mono", monospace; font-size: 0.72rem;
            color: rgba(255,255,255,0.66); background: #171b22;
            border: 1px solid rgba(255,255,255,0.09);
            border-radius: 999px; padding: 0.1rem 0.55rem;
          }
          .home { display: inline-block; margin-top: 2.5rem; font-size: 0.95rem; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <p class="eyebrow">RSS feed</p>
          <h1><xsl:value-of select="title"/></h1>
          <p class="desc"><xsl:value-of select="description"/></p>

          <div class="note">
            This is a <strong>feed</strong>, meant for a reader app rather than a
            browser. Subscribe by pasting this address into one:
            <br/>
            <code><xsl:value-of select="atom:link/@href"
              xmlns:atom="http://www.w3.org/2005/Atom"/></code>
          </div>

          <xsl:for-each select="item">
            <article>
              <h2>
                <a href="{link}"><xsl:value-of select="title"/></a>
              </h2>
              <div class="meta">
                <span><xsl:value-of select="substring(pubDate, 1, 16)"/></span>
                <xsl:if test="site:authorship">
                  <span>authorship: <xsl:value-of select="site:authorship"/></span>
                </xsl:if>
                <xsl:if test="site:reviewedBy">
                  <span>reviewed by <xsl:value-of select="site:reviewedBy"/></span>
                </xsl:if>
              </div>
              <p class="dek"><xsl:value-of select="description"/></p>
              <xsl:if test="category">
                <div class="tags">
                  <xsl:for-each select="category">
                    <span class="tag"><xsl:value-of select="."/></span>
                  </xsl:for-each>
                </div>
              </xsl:if>
            </article>
          </xsl:for-each>

          <a class="home" href="/astrobytes/">← All Astrobytes posts</a>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
