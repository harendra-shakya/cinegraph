# OriginTrail DKG research

Research date: 2026-09-10.

## DKG v10 memory model

OriginTrail DKG v10 presents three memory layers:

1. Working Memory: private, local drafts and scratch knowledge.
2. Shared Working Memory: selectively shared, peer-visible knowledge.
3. Verifiable Memory: network-stored, blockchain-anchored Knowledge Assets with durable integrity and provenance.

The recommended lifecycle is:

`Working Memory -> finalize/seal -> Shared Working Memory -> publish to Verifiable Memory`

Publishing is an explicit finality decision. It uses wallet resources and should not happen merely because a draft exists.

Sources:

- [DKG quickstart](https://docs.origintrail.io/getting-started/quickstart)
- [DKG key concepts](https://docs.origintrail.io/how-dkg-works/key-concepts)
- [Knowledge Assets](https://docs.origintrail.io/how-dkg-works/knowledge-assets)
- [Publish and query](https://docs.origintrail.io/use-dkg/publish-and-query)
- [OriginTrail DKG repository](https://github.com/OriginTrail/dkg)
- [DKG Hello World](https://github.com/OriginTrail/dkg-hello-world)

## Knowledge Assets and queries

A Knowledge Asset is graph-shaped RDF knowledge with ownership, provenance, and integrity information. A Context Graph scopes a knowledge domain. Agents can use free-text memory search for recall or SPARQL for precise graph patterns. Higher-trust memory ranks above lower-trust memory in free-text recall.

The Hello World integration is the smallest verified round trip: ensure a Context Graph, write four RDF triples into a Working Memory assertion, then query them back through the node HTTP API. It does not perform Shared Working Memory promotion or Verifiable Memory publishing.

## Integration recommendation

Start OpenCinema with a real local DKG Edge Node in Working Memory and Shared Working Memory. This keeps the creative workflow usable without forcing every draft prompt or media artifact into a public network. Shape identifiers, provenance, and versioning so a mature public lesson can later be promoted to Verifiable Memory without rewriting the ontology.

Testnet publication is a later evidence upgrade, not a prerequisite for the first working slice. If used, record the UAL, network, publication status, and verification instructions in the receipt and README. If not used, show the Edge Node setup, Knowledge Asset creation, query/readback, and the retrieved lesson before the next generation.

## Privacy boundary

Public or shared assets should contain minimized semantic lessons, stable identifiers, hashes, short reviewable observations, and references. They should not contain raw private prompts, unreleased scripts, large media bytes, API keys, wallet keys, private paths, or personal information. OpenCinema needs explicit memory scope on every write: private, team/shared, or public/verified.

