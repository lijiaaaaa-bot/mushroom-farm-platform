import { Role } from '@mushroom/contracts';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  shedCodes: string[];
}
