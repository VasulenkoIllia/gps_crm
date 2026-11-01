import { z } from "zod";

const CHECK_MODULUS = 11;
const LARGEST_CHECK_DIGIT = 9;
const CHECK_DIGIT_DIVISOR = 10;
const EDRPOU_LENGTH = 8;
const IPN_LENGTH = 10;
const EDRPOU_WEIGHTS = [1, 2, 3, 4, 5, 6, 7];
// Codes issued between these two carry the weights in another order
const EDRPOU_SHIFTED_FROM = 30_000_000;
const EDRPOU_SHIFTED_TO = 60_000_000;
const EDRPOU_SHIFTED_WEIGHTS = [7, 1, 2, 3, 4, 5, 6];
// A remainder of two digits is no check digit: the sum is taken again with every weight raised by this
const EDRPOU_RETRY_STEP = 2;
const IPN_WEIGHTS = [-1, 5, 7, 9, 4, 6, 10, 5, 7];

const EDRPOU_LENGTH_TEXT = "Перевірте ЄДРПОУ: 8 цифр";
const EDRPOU_CHECK_TEXT = "ЄДРПОУ з помилкою в контрольній цифрі";
const IPN_LENGTH_TEXT = "Перевірте ІПН: 10 цифр";
const IPN_CHECK_TEXT = "ІПН з помилкою в контрольній цифрі";

const digitsOf = (code: string) => [...code].map(Number);

function weightedSum(digits: number[], weights: number[]): number {
  return weights.reduce((sum, weight, index) => sum + weight * (digits[index] ?? 0), 0);
}

export function isValidEdrpou(code: string): boolean {
  if (!/^\d{8}$/.test(code)) return false;
  const digits = digitsOf(code);
  const value = Number(code);
  const isShifted = value >= EDRPOU_SHIFTED_FROM && value <= EDRPOU_SHIFTED_TO;
  const weights = isShifted ? EDRPOU_SHIFTED_WEIGHTS : EDRPOU_WEIGHTS;
  let remainder = weightedSum(digits, weights) % CHECK_MODULUS;
  if (remainder > LARGEST_CHECK_DIGIT) {
    const raised = weights.map((weight) => weight + EDRPOU_RETRY_STEP);
    remainder = weightedSum(digits, raised) % CHECK_MODULUS;
    if (remainder > LARGEST_CHECK_DIGIT) remainder = 0;
  }
  return remainder === digits[EDRPOU_LENGTH - 1];
}

export function isValidIpn(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  const digits = digitsOf(code);
  const remainder = ((weightedSum(digits, IPN_WEIGHTS) % CHECK_MODULUS) + CHECK_MODULUS) % CHECK_MODULUS;
  return remainder % CHECK_DIGIT_DIVISOR === digits[IPN_LENGTH - 1];
}

function taxIdProblem(code: string): string | null {
  if (code.length >= IPN_LENGTH) {
    if (!/^\d{10}$/.test(code)) return IPN_LENGTH_TEXT;
    return isValidIpn(code) ? null : IPN_CHECK_TEXT;
  }
  if (!/^\d{8}$/.test(code)) return EDRPOU_LENGTH_TEXT;
  return isValidEdrpou(code) ? null : EDRPOU_CHECK_TEXT;
}

export const taxIdSchema = z
  .string()
  .trim()
  .superRefine((code, context) => {
    const problem = taxIdProblem(code);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
