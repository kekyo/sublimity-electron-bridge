export class UserService {
  @ExposeToRenderer("userAPI")
  async getUser(id: number): Promise<User> {
    return { id, name: "Test User" } as User
  }

  @ExposeToRenderer("userAPI")
  async createUser(name: string, email: string): Promise<User> {
    return { id: 1, name, email } as User
  }

  @ExposeToRenderer()
  async getCurrentUser(): Promise<User | null> {
    return null
  }
}

interface User {
  id: number
  name: string
  email?: string
}