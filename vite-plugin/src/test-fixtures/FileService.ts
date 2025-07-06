export class FileService {
  /**
   * @decorator expose fileAPI
   */
  async readFile(path: string): Promise<string> {
    return "file content"
  }

  /**
   * @decorator expose fileAPI
   */
  async writeFile(path: string, content: string): Promise<void> {
    // implementation
  }

  /**
   * @decorator expose
   */
  async deleteFile(path: string): Promise<boolean> {
    return true
  }
}