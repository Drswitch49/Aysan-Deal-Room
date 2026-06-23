import {
  getAllDocuments,
  getAllSubmissionLog,
  getDealByRef,
  getDeals,
  getDocumentsForDeal,
  getSubmissionLogForDeal,
  getDealByRefForLender,
  getDocumentsForLender,
} from "../api/airtable";
import type { DealDocument, PipelineDeal, SubmissionLogEntry } from "../types/deal";
import { daysSince } from "../utils/fields";
import { useAsyncData } from "./useAsyncData";

export type DealListRow = {
  deal: PipelineDeal;
  outstandingDocumentCount: number;
  daysSinceLastLenderContact: number | null;
};

export function useDeals() {
  return useAsyncData<PipelineDeal[]>(() => getDeals(), []);
}

export function useDealListRows(refreshTrigger?: number) {
  return useAsyncData<DealListRow[]>(async () => {
    const [deals, documents, submissions] = await Promise.all([getDeals(), getAllDocuments(), getAllSubmissionLog()]);

    return deals.map((deal) => {
      const dealDocuments = documents.filter((doc) => doc.dealRef.toLowerCase() === deal.id.toLowerCase());
      const dealSubmissions = submissions.filter((entry) => entry.dealRef.toLowerCase() === deal.id.toLowerCase());
      const mostRecentSubmissionDate = dealSubmissions
        .map((entry) => entry.date)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        deal,
        outstandingDocumentCount: dealDocuments.length,
        daysSinceLastLenderContact: daysSince(mostRecentSubmissionDate),
      };
    });
  }, [refreshTrigger]);
}

export function useDeal(ref: string | undefined, refreshTrigger?: number) {
  return useAsyncData<PipelineDeal | null>(() => {
    if (!ref) return Promise.resolve(null);
    return getDealByRef(ref, refreshTrigger !== undefined && refreshTrigger > 0);
  }, [ref, refreshTrigger]);
}

export function useDealDocuments(ref: string | undefined, refreshTrigger?: number) {
  return useAsyncData<DealDocument[]>(() => {
    if (!ref) return Promise.resolve([]);
    return getDocumentsForDeal(ref);
  }, [ref, refreshTrigger]);
}

export function useSubmissionLog(ref: string | undefined) {
  return useAsyncData<SubmissionLogEntry[]>(() => {
    if (!ref) return Promise.resolve([]);
    return getSubmissionLogForDeal(ref);
  }, [ref]);
}

export function useLenderDeal(ref: string | undefined) {
  return useAsyncData<PipelineDeal | null>(() => {
    if (!ref) return Promise.resolve(null);
    return getDealByRefForLender(ref);
  }, [ref]);
}

export function useLenderDocuments(ref: string | undefined) {
  return useAsyncData<DealDocument[]>(() => {
    if (!ref) return Promise.resolve([]);
    return getDocumentsForLender(ref);
  }, [ref]);
}
