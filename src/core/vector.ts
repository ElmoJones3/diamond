/**
 * VectorService — local semantic embeddings using Transformers.js.
 *
 * This service provides the "semantic" half of Diamond's hybrid search.
 * It uses Xenova/all-MiniLM-L6-v2 (a compact but powerful SBERT model)
 * to convert documentation text into 384-dimensional numerical vectors.
 *
 * Why semantic search?
 *   Keyword search (MiniSearch) is great for exact terms but fails on
 *   conceptual queries like "how do I fix bugs" if the text uses "error
 *   handling". Embeddings represent the *meaning* of the text, allowing
 *   Diamond to find conceptually related content even with zero shared keywords.
 *
 * Why Transformers.js + all-MiniLM-L6-v2?
 *   1. No external API: Inference happens entirely on the user's machine.
 *   2. Compact: The model is ~23MB (quantized), making it lightweight
 *      for an offline-first tool.
 *   3. CPU-friendly: Highly optimized for running in Node.js/V8 without a GPU.
 *
 * Performance:
 *   - Sync time: Generating embeddings for a whole doc site is CPU-intensive.
 *     We mitigate this by chunking by headers and generating vectors once.
 *   - Search time: Generating an embedding for a 5-10 word query is near-instant
 *     (<50ms), and similarity comparison is a simple dot product.
 */

import { pipeline, type Pipeline, env } from '@xenova/transformers';

// Configure transformers.js for local usage
env.allowLocalModels = false; // We want to fetch from HF and cache locally

export interface VectorChunk {
  /** The parent document's ID (file path). */
  docId: string;
  /** The text content of this chunk. */
  text: string;
  /** The title of the parent document. */
  title: string;
  /** The original URL. */
  url: string;
  /** The embedding vector (384 dimensions for all-MiniLM-L6-v2). */
  embedding: number[];
}

export class VectorService {
  private extractor: any = null;

  /**
   * Initialize the embedding pipeline.
   * Downloads the model on the first run (cached in ~/.cache/huggingface).
   */
  async init() {
    if (this.extractor) return;

    this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      // Use 8-bit quantization for even faster inference and smaller size
      // Xenova pre-quantizes many models for us.
    });
  }

  /**
   * Generate an embedding for a piece of text.
   *
   * @param text The string to embed (max 512 tokens for MiniLM).
   * @returns A 384-dimensional number array.
   */
  async embed(text: string): Promise<number[]> {
    if (!this.extractor) await this.init();

    const output = await this.extractor!(text, {
      pooling: 'mean',
      normalize: true,
    });

    return Array.from(output.data as Float32Array);
  }

  /**
   * Calculate the cosine similarity between two vectors.
   *
   * Since our vectors are already normalized (magnitude = 1), cosine similarity
   * is just the dot product of the two arrays.
   */
  cosineSimilarity(v1: number[], v2: number[]): number {
    let dotProduct = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
    }
    return dotProduct;
  }

  /**
   * Chunk a Markdown document into smaller semantic pieces.
   *
   * Currently uses a simple heuristic: split by headers (h1, h2, h3).
   * If a section is still too long, it should ideally be sub-chunked,
   * but header-splitting is a great start for documentation.
   */
  chunkMarkdown(content: string): string[] {
    // Split by Markdown headers while keeping the header text in the chunk
    const sections = content.split(/(?=^#{1,3} )/m);
    return sections
      .map(s => s.trim())
      .filter(s => s.length > 20); // Lowered from 50 to include smaller docs
  }
}
