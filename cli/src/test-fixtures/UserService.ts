export class UserService {
  /**
   * @decorator expose userAPI
   */
  async getUser(id: number): Promise<User> {
    return { id, name: "Test User" } as User
  }

  /**
   * @decorator expose userAPI
   */
  async createUser(name: string, email: string): Promise<User> {
    return { id: 1, name, email } as User
  }

  /**
   * @decorator expose
   */
  async getCurrentUser(): Promise<User | null> {
    return null
  }
}

interface User {
  id: number
  name: string
  email?: string
}