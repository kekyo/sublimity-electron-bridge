export class FileService {
  @ExposeToRenderer("fileAPI")
  async readFile(path: string): Promise<string> {
    return "file content"
  }

  @ExposeToRenderer("fileAPI")
  async writeFile(path: string, content: string): Promise<void> {
    // implementation
  }

  @ExposeToRenderer()
  async deleteFile(path: string): Promise<boolean> {
    return true
  }
}