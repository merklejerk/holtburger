export interface AssetWorkerRequest {
  id: string;
  assetId: string;
  priority: 'bootstrap' | 'streaming' | 'prefetch';
}

export interface AssetWorkerResponse {
  id: string;
  status: 'pending' | 'ready' | 'error';
}

export type AssetWorkerMessage = AssetWorkerRequest | AssetWorkerResponse;