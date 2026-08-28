// Auth v2 in the current traditional CloudBase environment validates signup
// with ^$|^[a-z][0-9a-z_-]{5,24}$. The empty alternative is for accounts
// without a username; ShangHao requires one. Keep UI and main-process checks
// together: the generic documentation's 1–32 rule does not match this endpoint.
export const CLOUDBASE_USERNAME_MESSAGE =
  "账号需为 6～25 位，以小写字母开头，可包含小写字母、数字、下划线和短横线。昵称可以使用大写或中文。";

export const isValidCloudBaseUsername = (value: string): boolean =>
  /^[a-z][0-9a-z_-]{5,24}$/.test(value.trim());
