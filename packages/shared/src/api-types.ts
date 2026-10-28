// API の応答の型。画面と API で共有する。

export type MeUnregistered = {
  registered: false;
  lineDisplayName: string;
  terms: { termsText: string; privacyText: string };
};

export type MeRegistered = {
  registered: true;
  member: { id: number; lineDisplayName: string };
  household: { memberNo: string; displayName: string };
};

export type MeResponse = MeUnregistered | MeRegistered;

export type RegisterResponse = {
  memberNo: string;
  householdName: string;
};
